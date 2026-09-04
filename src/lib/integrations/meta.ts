import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Meta Ads owns ad spend for CAC / ROAS reporting. Written against Meta's
 * public Graph API / Marketing API shape, which is well documented, but
 * NOT executed against a live ad account. Confirm the API version and
 * field names against the current Graph API reference before go-live.
 */

const GRAPH_API_VERSION = "v20.0"; // TODO(verify): confirm current supported Graph API version at go-live time

async function metaGet(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN!);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Meta Graph API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export const metaAdsAdapter: IntegrationAdapter = {
  platform: "meta_ads",

  isConfigured() {
    return envPresent("META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID");
  },

  async testConnection() {
    try {
      await metaGet(`/${process.env.META_AD_ACCOUNT_ID}`, { fields: "id,name" });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    let synced = 0;

    const data = await metaGet(`/${process.env.META_AD_ACCOUNT_ID}/insights`, {
      fields: "campaign_name,spend,date_start",
      level: "campaign",
      date_preset: "last_30d",
      time_increment: "1",
    });

    for (const row of data?.data ?? []) {
      const { error } = await supabase.from("ad_spend").upsert(
        {
          external_id: `${row.campaign_name}-${row.date_start}`,
          platform: "meta",
          campaign_name: row.campaign_name,
          spend_date: row.date_start,
          spend_cents: Math.round(parseFloat(row.spend) * 100),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "platform,external_id,spend_date" }
      );
      if (!error) synced++;
      // NOTE: leads_attributed is intentionally NOT set here — Meta's
      // insights API reports leads it thinks it generated, which can
      // disagree with the CRM's own attribution. leads_attributed should
      // be backfilled from GoHighLevel's lead_source_id counts instead, to
      // keep one honest number rather than reconciling two.
    }

    return { status: "success", recordsSynced: synced };
  },
};
