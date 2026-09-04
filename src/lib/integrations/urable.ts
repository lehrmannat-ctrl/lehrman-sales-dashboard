import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Urable owns booked and completed jobs (scheduling system of record):
 * booking dates, completion status, and — as of this version — the
 * customer/service/price details Urable itself captures at booking time,
 * even for a job that never passed through the GoHighLevel CRM pipeline as
 * a "lead" (see supabase/migrations/0018_urable_direct_booking_fields.sql,
 * which made jobs.opportunity_id nullable specifically for this reason).
 *
 * NOT verified against a live Urable account — same caveat as quo.ts.
 * Confirm every path/shape below against Urable's current API docs before
 * go-live; TODO(verify) marks each unconfirmed assumption.
 *
 * WHAT URABLE CANNOT GIVE US (be honest about this rather than fabricating
 * it — see the owner's explicit instruction on this):
 *   - Marketing/ad attribution. Urable is a scheduling tool, not an ad
 *     platform or CRM — it has no concept of "which Meta campaign generated
 *     this booking." The closest it might offer is a free-text "how did you
 *     hear about us" field IF the owner's booking form asks that question
 *     and Urable exposes it via API (TODO(verify): confirm whether such a
 *     field exists in this account's booking form at all). Real Ad → Lead →
 *     Booking → Revenue attribution instead has to come from the
 *     lead_source_id captured when the lead first entered the CRM (see
 *     leads.lead_source_id) — which only exists for jobs that DO have an
 *     opportunity_id. A direct Urable booking with no opportunity_id has NO
 *     attribution path at all with the data available today; that gap is
 *     called out again in the Meta+Urable attribution write-up.
 *   - A stable "customer" entity across repeat visits. Urable jobs are
 *     synced as individual bookings; nothing here deduplicates or links
 *     multiple jobs by the same person into one customer record unless
 *     Urable's own API exposes a persistent customer_id (TODO(verify) — if
 *     it does, add a customer_external_id column and use it instead of
 *     name/phone matching, which is unreliable).
 */

const URABLE_API_BASE = "https://api.urable.com/v1"; // TODO(verify)

async function urableGet(path: string) {
  const res = await fetch(`${URABLE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.URABLE_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Urable API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Cents, tolerating a dollar-float or an already-integer-cents value from the API — TODO(verify) which Urable actually sends. */
function toCents(amount: unknown): number | null {
  if (amount === null || amount === undefined) return null;
  const n = typeof amount === "string" ? parseFloat(amount) : (amount as number);
  if (Number.isNaN(n)) return null;
  // Heuristic: Urable prices are very unlikely to be sub-$1 amounts, so if
  // it already looks like whole cents (an integer > 1000), trust it as-is;
  // otherwise treat it as dollars. TODO(verify) against a real payload.
  return Number.isInteger(n) && Math.abs(n) > 1000 ? n : Math.round(n * 100);
}

function mapJobStatus(urableStatus: string | undefined): "scheduled" | "in_progress" | "completed" | "canceled" {
  const s = (urableStatus ?? "").toLowerCase();
  if (s.includes("complete")) return "completed";
  if (s.includes("progress") || s.includes("started")) return "in_progress";
  if (s.includes("cancel")) return "canceled";
  return "scheduled";
}

export const urableAdapter: IntegrationAdapter = {
  platform: "urable",

  isConfigured() {
    return envPresent("URABLE_API_KEY", "URABLE_ACCOUNT_ID");
  },

  async testConnection() {
    try {
      await urableGet(`/accounts/${process.env.URABLE_ACCOUNT_ID}`); // TODO(verify)
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    let synced = 0;
    let hadUnmatchedOpportunity = false;

    // TODO(verify): confirm the jobs/appointments list endpoint & fields —
    // this assumes a `jobs` array with customer/service/price nested per
    // job, which is a common shape for field-service scheduling APIs but is
    // not confirmed against Urable's actual docs.
    const data = await urableGet(`/jobs?account_id=${process.env.URABLE_ACCOUNT_ID}&limit=100`);

    for (const job of data?.jobs ?? []) {
      // TODO(verify): confirm how to reliably resolve opportunity_id when
      // one exists — this assumes Urable stores our opportunity id in a
      // custom field/note, which must be set up when the job is created
      // (either manually, or by having GoHighLevel push it at booking
      // time). When absent, the job is still synced (see migration 0018)
      // as a direct booking with no CRM linkage — it is NOT dropped.
      const opportunityId: string | undefined = job.custom_fields?.opportunity_id;
      if (!opportunityId) hadUnmatchedOpportunity = true;

      // TODO(verify): field names below (customer.name/phone/email,
      // vehicle, service.name, price, address) are a best guess for a
      // typical field-service booking payload — confirm against a real
      // Urable job object.
      const { error } = await supabase.from("jobs").upsert(
        {
          external_id: job.id,
          source_platform: "urable",
          opportunity_id: opportunityId ?? null,
          scheduled_at: job.scheduled_at ?? null,
          completed_at: job.status === "completed" ? job.completed_at ?? null : null,
          status: mapJobStatus(job.status),
          customer_name: job.customer?.name ?? null,
          customer_phone: job.customer?.phone ?? null,
          customer_email: job.customer?.email ?? null,
          vehicle: job.vehicle ?? job.vehicle_description ?? null,
          service_name: job.service?.name ?? job.service_name ?? null,
          quoted_amount_cents: toCents(job.price ?? job.total_amount),
          service_address: job.address ?? job.service_address ?? null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
      if (!error) synced++;
    }

    return {
      status: "partial",
      recordsSynced: synced,
      errorMessage: hadUnmatchedOpportunity
        ? "Some jobs synced with no linked CRM opportunity (direct Urable bookings) — their revenue shows as Urable's quoted_amount_cents, not payments, and they have no marketing attribution. See urable.ts for what this means."
        : undefined,
    };
  },
};
