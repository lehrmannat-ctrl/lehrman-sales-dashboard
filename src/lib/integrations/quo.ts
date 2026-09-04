import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Quo owns call data (dials, connected calls, duration, recording URLs) —
 * see docs/architecture.md. NOT verified against a live Quo account: Quo is
 * a newer, smaller product and its public API surface was not confirmable
 * without live credentials. Treat every endpoint path/shape below as a
 * best-guess placeholder until confirmed against Quo's current API
 * reference — see docs/integration-setup-guide.md's Quo section for the
 * exact steps to verify and, if needed, correct this file.
 */

const QUO_API_BASE = "https://api.quo.com/v1"; // TODO(verify): confirm actual base URL from Quo's developer docs / account settings

async function quoGet(path: string) {
  const res = await fetch(`${QUO_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.QUO_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Quo API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export const quoAdapter: IntegrationAdapter = {
  platform: "quo",

  isConfigured() {
    return envPresent("QUO_API_KEY");
  },

  async testConnection() {
    try {
      // TODO(verify): replace with Quo's actual lightweight read-only endpoint
      await quoGet("/account");
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    let synced = 0;

    // TODO(verify): confirm the calls-list endpoint, its pagination, and
    // field names (this shape is a placeholder).
    const data = await quoGet("/calls?limit=100");

    for (const call of data?.calls ?? []) {
      const { error } = await supabase.from("activities").upsert(
        {
          external_id: call.id,
          source_platform: "quo",
          type: call.answered ? "connected_call" : "dial",
          direction: call.direction === "inbound" ? "inbound" : "outbound",
          outcome: call.disposition ?? null,
          duration_seconds: call.duration_seconds ?? null,
          recording_url: call.recording_url ?? null,
          occurred_at: call.started_at ?? new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
      if (!error) synced++;
      // NOTE: this activity row has no lead_id yet — linking a Quo call to
      // a lead requires matching call.from/to phone numbers against
      // leads.phone. That match step is intentionally left as a clearly
      // marked follow-up rather than guessed at here (see
      // docs/known-limitations.md).
    }

    return { status: "partial", recordsSynced: synced, errorMessage: "Calls synced without lead linkage — phone-number matching not yet implemented (see known-limitations.md)." };
  },
};
