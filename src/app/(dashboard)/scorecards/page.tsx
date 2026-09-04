import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange, type DateRangePreset } from "@/lib/date-ranges";
import { getScorecards, getScorecardWeights, getGoals, findGoal } from "@/lib/queries";
import { weightedScorecardScore, closeRate, showRate, formatCents, formatPercent } from "@/lib/kpi";
import { DateRangeFilter } from "@/components/DateRangeFilter";

export const dynamic = "force-dynamic";

function pctOfGoal(current: number, goal: number | null): number {
  if (!goal) return current > 0 ? 100 : 0;
  return Math.min(100, (current / goal) * 100);
}

export default async function ScorecardsPage({ searchParams }: { searchParams: { range?: string } }) {
  const preset = (searchParams.range as DateRangePreset) ?? "this_month";
  const range = resolveDateRange(preset);
  const supabase = createSupabaseServerClient();

  const [rows, weights, goals] = await Promise.all([
    getScorecards(supabase, range),
    getScorecardWeights(supabase),
    getGoals(supabase),
  ]);

  const dialGoal = findGoal(goals, "dials", "daily");
  const cashGoal = findGoal(goals, "cash_collected", "monthly");
  const closeRateGoal = findGoal(goals, "close_rate_pct", "monthly");
  const showRateGoal = findGoal(goals, "show_rate_pct", "monthly");
  const avgTicketGoal = findGoal(goals, "average_ticket_cents", "monthly");

  const ranked = rows
    .map((r) => {
      const cr = closeRate(r.dealsClosed, r.appointmentsShowed);
      const sr = showRate(r.appointmentsShowed, r.appointmentsBooked);
      const avgTicket = r.dealsClosed > 0 ? r.revenueSoldCents / r.dealsClosed : 0;
      const followUpRate = r.followUpsTotal > 0 ? (r.followUpsCompleted / r.followUpsTotal) * 100 : 100;

      const score = weights
        ? weightedScorecardScore(
            {
              cashCollectedPctOfGoal: pctOfGoal(r.cashCollectedCents, cashGoal),
              closeRatePctOfGoal: pctOfGoal(cr, closeRateGoal),
              avgTicketPctOfGoal: pctOfGoal(avgTicket, avgTicketGoal),
              followUpCompletionPctOfGoal: followUpRate,
              showRatePctOfGoal: pctOfGoal(sr, showRateGoal),
              activityPctOfGoal: pctOfGoal(r.dials, dialGoal),
              crmDataAccuracyPct: 100, // TODO: wire up a real data-quality check (missing attribution %, stale leads %) once integrations are live
            },
            weights
          )
        : null;

      return { ...r, closeRatePct: cr, showRatePct: sr, avgTicketCents: avgTicket, followUpRate, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Scorecards</h1>
          <p className="text-sm text-slate-400">Ranked by a weighted score — activity, conversion, and cash, never revenue alone.</p>
        </div>
        <DateRangeFilter current={preset} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-charcoal-700">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Dials</th>
              <th className="px-4 py-3">Connected</th>
              <th className="px-4 py-3">Booked</th>
              <th className="px-4 py-3">Showed</th>
              <th className="px-4 py-3">Show Rate</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3">Close Rate</th>
              <th className="px-4 py-3">Avg Ticket</th>
              <th className="px-4 py-3">Revenue Sold</th>
              <th className="px-4 py-3">Cash Collected</th>
              <th className="px-4 py-3">Follow-up %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-800">
            {ranked.map((r, i) => (
              <tr key={r.profileId} className="text-slate-200">
                <td className="px-4 py-3 font-semibold text-white">#{i + 1}</td>
                <td className="px-4 py-3">{r.fullName}</td>
                <td className="px-4 py-3 font-semibold text-brand-500">{r.score !== null ? r.score.toFixed(1) : "—"}</td>
                <td className="px-4 py-3">{r.dials}</td>
                <td className="px-4 py-3">{r.connectedCalls}</td>
                <td className="px-4 py-3">{r.appointmentsBooked}</td>
                <td className="px-4 py-3">{r.appointmentsShowed}</td>
                <td className="px-4 py-3">{formatPercent(r.showRatePct)}</td>
                <td className="px-4 py-3">{r.dealsClosed}</td>
                <td className="px-4 py-3">{formatPercent(r.closeRatePct)}</td>
                <td className="px-4 py-3">{formatCents(r.avgTicketCents)}</td>
                <td className="px-4 py-3">{formatCents(r.revenueSoldCents)}</td>
                <td className="px-4 py-3">{formatCents(r.cashCollectedCents)}</td>
                <td className="px-4 py-3">{formatPercent(r.followUpRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!weights && (
        <p className="text-xs text-status-warn">No scorecard weights found — run supabase/seed.sql, or set them on the Goals &amp; Targets page.</p>
      )}
    </div>
  );
}
