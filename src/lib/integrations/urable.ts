import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Urable owns booked and completed jobs (scheduling system of record). NOT
 * verified against a live Urable account — same caveat as quo.ts. Confirm
 * every path/shape below against Urable's current API docs before go-live.
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

    // TODO(verify): confirm the jobs/appointments list endpoint & fields.
    const data = await urableGet(`/jobs?account_id=${process.env.URABLE_ACCOUNT_ID}&limit=100`);

    for (const job of data?.jobs ?? []) {
      // TODO(verify): confirm how to reliably resolve opportunity_id — this
      // assumes Urable stores our opportunity id in a custom field/note,
      // which must be set up when the job is created (either manually or
      // by having GoHighLevel push it at booking time).
      const opportunityId: string | undefined = job.custom_fields?.opportunity_id;
      if (!opportunityId) continue;

      const { error } = await supabase.from("jobs").upsert(
        {
          external_id: job.id,
          source_platform: "urable",
          opportunity_id: opportunityId,
          scheduled_at: job.scheduled_at ?? null,
          completed_at: job.status === "completed" ? job.completed_at : null,
          status: job.status ?? "scheduled",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
      if (!error) synced++;
    }

    return { status: "partial", recordsSynced: synced, errorMessage: "Jobs synced only where a linked opportunity_id was found (see TODOs)." };
  },
};
