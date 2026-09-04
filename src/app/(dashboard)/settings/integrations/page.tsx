import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { manualResync } from "./actions";
import { CallSummarySync } from "./CallSummarySync";
import { callSummariesConfigured } from "@/lib/integrations/call-summaries";
import type { IntegrationPlatform } from "@/types/database";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  gohighlevel: "GoHighLevel (CRM)",
  quo: "Quo (Phone Tracking)",
  stripe: "Stripe (Payments)",
  urable: "Urable (Scheduling)",
  meta_ads: "Meta Ads (Advertising)",
};

export default async function IntegrationsSettingsPage() {
  const supabase = createSupabaseServerClient();
  const { data: integrations } = await supabase.from("integrations").select("*").order("platform");
  const { data: recentLogs } = await supabase.from("sync_logs").select("*").order("started_at", { ascending: false }).limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Integrations</h1>
        <p className="text-sm text-slate-400">
          Every status below reflects the database exactly — nothing here is hard-coded to look connected.
          See docs/integration-setup-guide.md to actually connect each one.
        </p>
      </div>

      <div className="space-y-3">
        {(integrations ?? []).map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">{PLATFORM_LABELS[row.platform as IntegrationPlatform]}</p>
                <StatusPill value={row.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Last success: {row.last_success_at ? new Date(row.last_success_at).toLocaleString() : "Never"} · Records synced:{" "}
                {row.records_synced_total}
              </p>
              {row.last_error && <p className="mt-1 text-xs text-status-bad">{row.last_error}</p>}
            </div>
            <form action={manualResync.bind(null, row.platform)}>
              <button className="rounded-md border border-charcoal-600 px-3 py-1.5 text-xs text-slate-200 hover:border-charcoal-500">
                Resync now
              </button>
            </form>
          </div>
        ))}
      </div>

      <CallSummarySync configured={callSummariesConfigured()} />

      <div>
        <h2 className="mb-2 text-sm font-medium text-white">Recent sync log</h2>
        <div className="overflow-x-auto rounded-xl border border-charcoal-700">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Records</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-800">
              {(recentLogs ?? []).map((log: any) => (
                <tr key={log.id} className="text-slate-200">
                  <td className="px-4 py-3 text-xs">{new Date(log.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3 capitalize">{log.status}</td>
                  <td className="px-4 py-3">{log.records_synced}</td>
                  <td className="px-4 py-3 text-xs text-status-bad">{log.error_message ?? "—"}</td>
                </tr>
              ))}
              {(recentLogs ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No syncs have run yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
