import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { IntegrationPlatform } from "@/types/database";
import type { IntegrationAdapter, SyncResult } from "./types";
import { gohighlevelAdapter } from "./gohighlevel";
import { quoAdapter } from "./quo";
import { stripeAdapter } from "./stripe";
import { urableAdapter } from "./urable";
import { metaAdsAdapter } from "./meta";

export const ADAPTERS: Record<IntegrationPlatform, IntegrationAdapter> = {
  gohighlevel: gohighlevelAdapter,
  quo: quoAdapter,
  stripe: stripeAdapter,
  urable: urableAdapter,
  meta_ads: metaAdsAdapter,
};

/**
 * Runs one adapter's sync(), writes a sync_logs row, and updates the
 * integrations table honestly — including flipping status back to
 * "not_connected" if the env vars simply aren't set (never leaves a stale
 * "connected" status showing once credentials are removed).
 */
export async function runSync(platform: IntegrationPlatform): Promise<SyncResult> {
  const supabase = createSupabaseServiceRoleClient();
  const adapter = ADAPTERS[platform];

  const { data: integrationRow } = await supabase
    .from("integrations")
    .select("id")
    .eq("platform", platform)
    .single();
  if (!integrationRow) throw new Error(`No integrations row for platform "${platform}" — check migration 0001 seed.`);

  if (!adapter.isConfigured()) {
    await supabase.from("integrations").update({ status: "not_connected" }).eq("id", integrationRow.id);
    return { status: "not_connected", recordsSynced: 0 };
  }

  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ integration_id: integrationRow.id, status: "running" })
    .select("id")
    .single();

  let result: SyncResult;
  try {
    result = await adapter.sync();
  } catch (err: any) {
    result = { status: "failed", recordsSynced: 0, errorMessage: err?.message ?? String(err) };
  }

  await supabase
    .from("sync_logs")
    .update({
      finished_at: new Date().toISOString(),
      status: result.status,
      records_synced: result.recordsSynced,
      error_message: result.errorMessage ?? null,
    })
    .eq("id", logRow?.id);

  await supabase
    .from("integrations")
    .update({
      status: result.status === "success" || result.status === "partial" ? "connected" : "error",
      last_success_at: result.status === "success" ? new Date().toISOString() : undefined,
      last_failure_at: result.status === "failed" ? new Date().toISOString() : undefined,
      last_error: result.errorMessage ?? null,
      records_synced_total: undefined, // incremented via SQL below to avoid a read-modify-write race
    })
    .eq("id", integrationRow.id);

  if (result.recordsSynced > 0) {
    await supabase.rpc("increment_integration_records_synced", {
      p_integration_id: integrationRow.id,
      p_count: result.recordsSynced,
    });
  }

  return result;
}

export async function runAllSyncs(): Promise<Record<IntegrationPlatform, SyncResult>> {
  const platforms = Object.keys(ADAPTERS) as IntegrationPlatform[];
  const results = await Promise.all(platforms.map((p) => runSync(p)));
  return Object.fromEntries(platforms.map((p, i) => [p, results[i]])) as Record<IntegrationPlatform, SyncResult>;
}
