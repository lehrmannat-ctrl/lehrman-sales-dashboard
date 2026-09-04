import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Meta Ads owns ad spend for CAC / ROAS reporting, plus (as of this
 * version) ad-set/ad-level performance detail for the marketing-audit
 * automations — a campaign-level rollup alone can't answer "which specific
 * ad got worse." Written against Meta's public Graph API / Marketing API
 * shape, which is well documented, but NOT executed against a live ad
 * account. Confirm the API version and field names against the current
 * Graph API reference before go-live — TODO(verify) marks each assumption.
 *
 * ATTRIBUTION HONESTY (see docs/marketing-attribution.md for the full
 * write-up): `meta_leads` below is Meta's OWN count of leads it thinks it
 * generated per ad (from its pixel/conversions data), which is well known
 * to disagree with what actually shows up in the CRM — Meta tends to
 * over-count. It is kept and labeled separately from the CRM's own lead
 * counts (leads.lead_source_id), never blended into one number. A specific
 * lead cannot be tied back to a specific ad_id today (leads.attributed_ad_id
 * is null for virtually everyone) — that requires instrumenting the lead
 * capture form to pass through fbclid/UTM params, which is a setup task on
 * the CRM/website side, not something this adapter can backfill on its own.
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

/** Meta's `actions` array is a list of {action_type, value} pairs. Sums every action_type that looks lead-related — TODO(verify): confirm the exact action_type string(s) this ad account's lead events actually use (commonly "lead" for on-platform lead ads, or "offsite_conversion.fb_pixel_lead" / a custom conversion name for website forms) and narrow this if it's over-counting. */
function sumLeadActions(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => /lead/i.test(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value, 10) || 0), 0);
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
    let hadError = false;

    // --- Campaign-level rollup (unchanged from before; getLeadSourceReport reads this) ---
    const campaignData = await metaGet(`/${process.env.META_AD_ACCOUNT_ID}/insights`, {
      fields: "campaign_name,spend,date_start",
      level: "campaign",
      date_preset: "last_30d",
      time_increment: "1",
    });

    for (const row of campaignData?.data ?? []) {
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
      else hadError = true;
      // NOTE: leads_attributed is intentionally NOT set here — Meta's
      // insights API reports leads it thinks it generated, which can
      // disagree with the CRM's own attribution. leads_attributed should
      // be backfilled from GoHighLevel's lead_source_id counts instead, to
      // keep one honest number rather than reconciling two.
    }

    // --- Ad-set/ad-level detail (new — feeds the marketing-audit automations) ---
    // TODO(verify): confirm "inline_link_clicks" and "actions" are returned
    // as named here at level=ad in the current Graph API version — both
    // are standard Insights fields historically, but field availability
    // has shifted across API versions before.
    const adData = await metaGet(`/${process.env.META_AD_ACCOUNT_ID}/insights`, {
      fields:
        "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,frequency,spend,clicks,inline_link_clicks,actions,date_start",
      level: "ad",
      date_preset: "last_30d",
      time_increment: "1",
    });

    for (const row of adData?.data ?? []) {
      const { error } = await supabase.from("ad_performance_daily").upsert(
        {
          platform: "meta",
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name ?? null,
          adset_id: row.adset_id,
          adset_name: row.adset_name ?? null,
          ad_id: row.ad_id,
          ad_name: row.ad_name ?? null,
          spend_date: row.date_start,
          impressions: parseInt(row.impressions ?? "0", 10),
          reach: parseInt(row.reach ?? "0", 10),
          frequency: row.frequency ? parseFloat(row.frequency) : null,
          spend_cents: Math.round(parseFloat(row.spend ?? "0") * 100),
          link_clicks: parseInt(row.inline_link_clicks ?? "0", 10),
          clicks: parseInt(row.clicks ?? "0", 10),
          meta_leads: sumLeadActions(row.actions),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "platform,ad_id,spend_date" }
      );
      if (!error) synced++;
      else hadError = true;
    }

    return { status: hadError ? "partial" : "success", recordsSynced: synced };
  },
};
