import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange } from "@/lib/date-ranges";
import { getForecastInputs, getGoals, findGoal } from "@/lib/queries";
import { computeForecast, remainingSellingDaysInMonth, formatCents, formatPercent } from "@/lib/kpi";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const supabase = createSupabaseServerClient();
  const monthRange = resolveDateRange("this_month");
  const now = new Date();

  const [inputs, goals] = await Promise.all([getForecastInputs(supabase, monthRange), getGoals(supabase)]);
  const monthlyRevenueGoal = findGoal(goals, "revenue_sold", "monthly");
  const remainingDays = remainingSellingDaysInMonth(now);

  const forecast = computeForecast({
    ...inputs,
    remainingSellingDays: remainingDays,
    monthlyRevenueGoalCents: monthlyRevenueGoal,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Sales Forecast</h1>
        <p className="text-sm text-slate-400">Every assumption below is visible — nothing is a hidden model.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs uppercase text-slate-400">Conservative</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCents(forecast.conservativeCents)}</p>
          <p className="mt-1 text-xs text-slate-500">Assumes nothing else in the pipeline closes this month.</p>
        </div>
        <div className="rounded-xl border border-brand-500/40 bg-brand-600/10 p-4">
          <p className="text-xs uppercase text-slate-400">Expected</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCents(forecast.expectedCents)}</p>
          <p className="mt-1 text-xs text-slate-500">Open pipeline × {formatPercent(inputs.historicalCloseRatePct)} historical close rate.</p>
        </div>
        <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
          <p className="text-xs uppercase text-slate-400">Aggressive</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCents(forecast.aggressiveCents)}</p>
          <p className="mt-1 text-xs text-slate-500">Assumes a 50% better-than-average close rate this month.</p>
        </div>
      </div>

      <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-5">
        <h2 className="text-sm font-medium text-white">Gap to Goal</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div><p className="text-slate-400">Monthly Target</p><p className="text-white">{monthlyRevenueGoal !== null ? formatCents(monthlyRevenueGoal) : "Not set"}</p></div>
          <div><p className="text-slate-400">Gap to Target</p><p className={forecast.gapToTargetCents ? "text-status-bad" : "text-status-good"}>{forecast.gapToTargetCents !== null ? formatCents(forecast.gapToTargetCents) : "—"}</p></div>
          <div><p className="text-slate-400">Remaining Selling Days</p><p className="text-white">{remainingDays} (Sundays excluded)</p></div>
          <div><p className="text-slate-400">Revenue Needed / Day</p><p className="text-white">{forecast.revenueNeededPerRemainingDayCents !== null ? formatCents(forecast.revenueNeededPerRemainingDayCents) : "—"}</p></div>
          <div><p className="text-slate-400">Appointments Needed</p><p className="text-white">{forecast.appointmentsNeeded !== null ? Math.ceil(forecast.appointmentsNeeded) : "—"}</p></div>
          <div><p className="text-slate-400">Deals Needed</p><p className="text-white">{forecast.dealsNeeded !== null ? Math.ceil(forecast.dealsNeeded) : "—"}</p></div>
          <div><p className="text-slate-400">Leads Needed</p><p className="text-white">{forecast.leadsNeeded !== null ? Math.ceil(forecast.leadsNeeded) : "—"}</p></div>
        </div>
      </div>

      <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-5 text-xs text-slate-400">
        <h2 className="mb-2 text-sm font-medium text-white">Assumptions used</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>Historical close rate ({formatPercent(inputs.historicalCloseRatePct)}), avg ticket ({formatCents(inputs.historicalAvgTicketCents)}), and lead-to-deal rate ({formatPercent(inputs.historicalLeadToDealRatePct)}) are all trailing-90-day averages.</li>
          <li>Open pipeline value: {formatCents(inputs.openPipelineValueCents)} across qualified-through-showed opportunities.</li>
          <li>These are starting assumptions, not fixed constants — see docs/kpi-dictionary.md to adjust the trailing window or swap in owner-set targets instead of historical averages.</li>
        </ul>
      </div>
    </div>
  );
}
