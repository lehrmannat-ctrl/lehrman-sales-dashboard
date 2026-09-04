import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * GoHighLevel (branded to this business as "Surge CRM") owns leads and
 * their pipeline stage/temperature — see docs/architecture.md "data
 * ownership rules". Real-time updates should arrive via GHL's outbound
 * webhook (src/app/api/webhooks/gohighlevel/route.ts); sync() below is the
 * polling backfill path.
 *
 * Lehrman Mobile Detail's actual GoHighLevel pipeline (confirmed by the
 * owner, 2026-08-28) is lead-status shaped, not a priced-deal funnel:
 *   Ceramic (= new leads) -> Initial Contact -> Cold/Warm/Hot Lead -> WON
 *   (or Disqualified at any point)
 * That's a simpler shape than this app's internal 13-stage `pipeline_stage`
 * enum, so GHL sync only ever sets a lead's `stage` + `temperature` — it
 * never creates `opportunities` rows. Opportunities (with a dollar value)
 * get created inside this app once a sales associate qualifies a lead;
 * the deeper post-sale stages (deposit_collected, paid_in_full,
 * job_completed) come from Stripe/Urable, not GoHighLevel.
 *
 * CONFIRMED against a live account, 2026-08-28: the connection (API key +
 * location ID) works and contacts sync successfully. The first live test
 * also confirmed the suspicion flagged in an earlier TODO here — GHL v2
 * attaches pipeline stage to the OPPORTUNITY record, not the contact, so
 * every contact was landing as "new_lead" with no way to tell them apart.
 * Fixed below by pulling opportunities separately and joining them to
 * contacts by contactId. The exact opportunities/search response shape is
 * still unconfirmed beyond what the fix assumes (`opportunities[].contactId`,
 * `.pipelineStageId`, `.updatedAt`) — if stages are STILL wrong after this,
 * that join is the next thing to check (see TODO(verify) below).
 *
 * Also confirmed against the live account, same day: the owner treats
 * Cold/Warm/Hot Lead as this business's definition of "qualified" (a lead
 * has been worked and categorized, vs. still brand new/uncontacted) - so
 * those three GHL stages map to this app's `qualified` pipeline_stage, not
 * `contacted`. And this account gets a steady stream of spam contacts from
 * Google Ads/Calls that land with no name at all - the sync skips any
 * contact with neither a first nor last name entirely (never creates a
 * lead row for it) so those never pollute lead counts or the Leads page.
 * A one-time cleanup of ~235 already-synced spam rows still needs a human
 * to run (a bulk delete on real customer data - not something this sync
 * code, or an AI acting on the account, should do unattended).
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28"; // TODO(verify): confirm current GHL API version header
const MAX_PAGES = 50; // safety bound: 50 pages x 100 records = 5,000 records per sync run

async function ghlGet(path: string) {
  const res = await fetch(`${GHL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: GHL_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`GoHighLevel API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Lehrman Mobile Detail's real GoHighLevel "Leads Pipeline" stage names,
// mapped to this app's pipeline_stage + lead_temperature. Names are matched
// case-insensitively, trimmed. If GHL's stage names ever change, update the
// two maps below to match exactly - a name that doesn't match falls back to
// 'new_lead' / 'unset' (see mapGhlStageToPipelineStage/mapGhlStageToTemperature)
// rather than silently guessing.
const STAGE_MAP: Record<string, string> = {
  ceramic: "new_lead", // this business's "new lead" stage is literally named "Ceramic"
  "initial contact": "attempting_contact",
  "cold lead": "qualified", // the owner's definition of "qualified": given a temperature at all
  "warm lead": "qualified",
  "hot lead": "qualified",
  won: "sold",
  disqualified: "lost",
};

const TEMPERATURE_MAP: Record<string, string> = {
  "cold lead": "cold",
  "warm lead": "warm",
  "hot lead": "hot",
};

function mapGhlStageToPipelineStage(ghlStageName: string): string {
  const normalized = ghlStageName.trim().toLowerCase();
  return STAGE_MAP[normalized] ?? "new_lead";
}

function mapGhlStageToTemperature(ghlStageName: string): string {
  const normalized = ghlStageName.trim().toLowerCase();
  return TEMPERATURE_MAP[normalized] ?? "unset";
}

// GHL v2 identifies an opportunity's stage by `pipelineStageId`, not by
// name - so before mapping anything we have to fetch this location's
// pipeline definition and build an id -> stage-name lookup.
// TODO(verify): confirm this is still the correct endpoint/response shape
// (fields seen in GHL's public docs: `pipelines[].id`, `.name`,
// `.stages[].id`, `.stages[].name`).
async function fetchStageIdToNameMap(): Promise<Record<string, string>> {
  const data = await ghlGet(`/opportunities/pipelines/?locationId=${process.env.GHL_LOCATION_ID}`);
  const idToName: Record<string, string> = {};
  for (const pipeline of data?.pipelines ?? []) {
    for (const stage of pipeline?.stages ?? []) {
      if (stage?.id && stage?.name) idToName[stage.id] = stage.name;
    }
  }
  return idToName;
}

// Confirmed via live testing 2026-08-28: contacts alone don't carry stage.
// Pull opportunities and build contactId -> pipelineStageId, preferring the
// most recently updated opportunity when a contact has more than one.
// TODO(verify): confirm the exact field names below
// (`opportunities[].contactId`, `.pipelineStageId`, `.updatedAt`) and the
// pagination cursor - this is written from GHL's documented v2 shape but
// this specific loop has not itself been executed against a live account.
async function fetchContactStageIds(): Promise<Record<string, string>> {
  const contactIdToStageId: Record<string, string> = {};
  const contactIdToUpdatedAt: Record<string, string> = {};
  let startAfterId: string | undefined;
  let startAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let path = `/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&limit=100`;
    if (startAfterId && startAfter) path += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;

    const data = await ghlGet(path);
    const opportunities = data?.opportunities ?? [];

    for (const opp of opportunities) {
      const contactId = opp?.contactId;
      const stageId = opp?.pipelineStageId;
      if (!contactId || !stageId) continue;
      const updatedAt = opp?.updatedAt ?? opp?.createdAt ?? "";
      const previousUpdatedAt = contactIdToUpdatedAt[contactId];
      if (!previousUpdatedAt || updatedAt >= previousUpdatedAt) {
        contactIdToStageId[contactId] = stageId;
        contactIdToUpdatedAt[contactId] = updatedAt;
      }
    }

    const meta = data?.meta;
    if (opportunities.length < 100 || !meta?.startAfterId) break;
    startAfterId = meta.startAfterId;
    startAfter = meta.startAfter;
  }

  return contactIdToStageId;
}

export const gohighlevelAdapter: IntegrationAdapter = {
  platform: "gohighlevel",

  isConfigured() {
    return envPresent("GHL_API_KEY", "GHL_LOCATION_ID");
  },

  async testConnection() {
    try {
      // TODO(verify): confirm the lightest-weight read-only endpoint for
      // this account's GHL API version (e.g. GET /locations/{id}).
      await ghlGet(`/locations/${process.env.GHL_LOCATION_ID}`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    let synced = 0;
    const errors: string[] = [];

    // Build the stage id->name lookup and the contact->stage join once per
    // sync run, not once per contact. If either fails, contacts still sync
    // - they just keep whatever stage/temperature they already had (never
    // silently reset to "new_lead").
    let stageIdToName: Record<string, string> = {};
    let contactStageIds: Record<string, string> = {};
    try {
      stageIdToName = await fetchStageIdToNameMap();
    } catch (err: any) {
      errors.push(`pipeline stage lookup failed: ${err?.message ?? String(err)}`);
    }
    try {
      contactStageIds = await fetchContactStageIds();
    } catch (err: any) {
      errors.push(`opportunity/stage lookup failed: ${err?.message ?? String(err)}`);
    }

    // TODO(verify): confirm the contacts list endpoint and pagination
    // cursor for this account's GHL API version.
    let contactStartAfterId: string | undefined;
    let contactStartAfter: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      let path = `/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=100`;
      if (contactStartAfterId && contactStartAfter) {
        path += `&startAfterId=${contactStartAfterId}&startAfter=${contactStartAfter}`;
      }

      const contactsData = await ghlGet(path);
      const contacts = contactsData?.contacts ?? [];

      for (const contact of contacts) {
        // Skip spam contacts with no name at all (this account gets a
        // steady stream of these from Google Ads/Calls) - never create a
        // lead row for them, so they can't inflate lead counts anywhere in
        // the app. A real lead always has at least a first or last name.
        const hasName = Boolean(contact.firstName?.trim()) || Boolean(contact.lastName?.trim());
        if (!hasName) continue;

        const leadRow: Record<string, unknown> = {
          external_id: contact.id,
          source_platform: "gohighlevel",
          first_name: contact.firstName ?? null,
          last_name: contact.lastName ?? null,
          phone: contact.phone ?? null,
          email: contact.email ?? null,
          attribution_missing: !contact.source,
          created_at: contact.dateAdded ?? new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        };

        const stageId = contactStageIds[contact.id];
        const stageName = stageId ? stageIdToName[stageId] : undefined;
        if (stageName) {
          leadRow.stage = mapGhlStageToPipelineStage(stageName);
          leadRow.temperature = mapGhlStageToTemperature(stageName);
        }

        const { error } = await supabase.from("leads").upsert(leadRow, { onConflict: "source_platform,external_id" });
        if (!error) synced++;
        else errors.push(error.message);
      }

      const meta = contactsData?.meta;
      if (contacts.length < 100 || !meta?.startAfterId) break;
      contactStartAfterId = meta.startAfterId;
      contactStartAfter = meta.startAfter;
    }

    if (errors.length > 0) {
      return {
        status: synced > 0 ? "partial" : "failed",
        recordsSynced: synced,
        errorMessage: errors.slice(0, 3).join(" | ") + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ""),
      };
    }
    return { status: "success", recordsSynced: synced };
  },
};

export { mapGhlStageToPipelineStage, mapGhlStageToTemperature };
