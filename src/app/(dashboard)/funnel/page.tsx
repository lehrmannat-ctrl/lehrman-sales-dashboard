import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFullFunnel } from "@/lib/queries";
import { formatCents, formatPercent } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  attempting_contact: "Attempting Contact",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment_booked: "Appointment Booked",
  appointment_confirmed: "Appointment Confirmed",
  showed: "Showed",
  sold: "Sold",
  deposit_collected: "Deposit Collected",
  paid_in_full: "Paid in Full",
  job_completed: "Job Completed",
  review_requested: "Review Requested",
};

export default async function FunnelPage() {
  const supabase = createSupabaseServerClient();
  const stages = await getFullFunnel(supabase);

  const maxEverReached = Math.max(1, ...stages.map((s) => s.everReachedCount));

  // Largest single-stage leak: biggest % drop in ever-reached count from
  // the previous stage to this one.
  let biggestLeak: { from: string; to: string; fromCount: number; toCount: number; rate: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const cur = stages[i];
    if (prev.everReachedCount === 0) continue;
    const rate = (cur.everReachedCount / prev.everReachedCount) * 100;
    if (!biggestLeak || rate < biggestLeak.rate) {
      biggestLeak = { from: prev.stage, to: cur.stage, fromCount: prev.everReachedCount, toCount: cur.everReachedCount, rate };
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Sales Funnel</h1>
        <p className="text-sm text-slate-400">Lifetime view — every lead/opportunity that has ever reached each stage, not just what&apos;s sitting there today.</p>
      </div>

      {biggestLeak && (
        <div className="rounded-xl border border-status-warn/40 bg-status-warn/10 p-4 text-sm text-status-warn">
          <strong>Biggest leak:</strong> {biggestLeak.fromCount} reached &ldquo;{STAGE_LABELS[biggestLeak.from]}&rdquo;, but only{" "}
          {biggestLeak.toCount} made it to &ldquo;{STAGE_LABELS[biggestLeak.to]}&rdquo; — a {formatPercent(biggestLeak.rate)} conversion, the weakest
          link in the pipeline right now.
        </div>
      )}

      <div className="space-y-2">
        {stages.map((s, i) => {
          const widthPct = Math.max(4, (s.everReachedCount / maxEverReached) * 100);
          const prevCount = i > 0 ? stages[i - 1].everReachedCount : null;
          const conversionFromPrev = prevCount && prevCount > 0 ? (s.everReachedCount / prevCount) * 100 : null;

          return (
            <div key={s.stage} className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span>{s.everReachedCount} ever reached</span>
                  <span>{s.currentCount} currently here</span>
                  {conversionFromPrev !== null && <span>{formatPercent(conversionFromPrev)} from previous stage</span>}
                  {s.avgTimeInStageHours !== null && <span>~{s.avgTimeInStageHours.toFixed(0)}h avg in stage</span>}
                  {s.revenueAttachedCents > 0 && <span>{formatCents(s.revenueAttachedCents)} revenue</span>}
                  {s.cashCollectedCents > 0 && <span>{formatCents(s.cashCollectedCents)} cash</span>}
                </div>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-charcoal-800">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
