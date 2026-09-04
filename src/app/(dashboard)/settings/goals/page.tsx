import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGoals, getScorecardWeights } from "@/lib/queries";
import { setGoal, updateScorecardWeights } from "./actions";

export const dynamic = "force-dynamic";

const GOAL_METRICS: { key: string; label: string; period: "daily" | "weekly" | "monthly" }[] = [
  { key: "revenue_sold", label: "Monthly Revenue Target", period: "monthly" },
  { key: "cash_collected", label: "Monthly Cash Target", period: "monthly" },
  { key: "cash_collected", label: "Weekly Cash Target", period: "weekly" },
  { key: "dials", label: "Daily Dial Target", period: "daily" },
  { key: "conversations", label: "Daily Conversation Target", period: "daily" },
  { key: "appointments_booked", label: "Monthly Appointment Target", period: "monthly" },
  { key: "show_rate_pct", label: "Show Rate Target (%)", period: "monthly" },
  { key: "close_rate_pct", label: "Close Rate Target (%)", period: "monthly" },
  { key: "average_ticket_cents", label: "Average Ticket Target (cents)", period: "monthly" },
  { key: "speed_to_lead_minutes", label: "Speed to Lead Target (minutes)", period: "monthly" },
];

export default async function GoalsSettingsPage() {
  const supabase = createSupabaseServerClient();
  const [goals, weights] = await Promise.all([getGoals(supabase), getScorecardWeights(supabase)]);

  function latest(metricKey: string, period: string) {
    return goals.find((g) => g.metric_key === metricKey && g.period === period)?.target_value;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">Goals &amp; Targets</h1>
        <p className="text-sm text-slate-400">Every target here is a database row, not a code constant — change it any time.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {GOAL_METRICS.map((m) => (
          <form key={`${m.key}-${m.period}`} action={setGoal} className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
            <input type="hidden" name="metric_key" value={m.key} />
            <input type="hidden" name="period" value={m.period} />
            <label className="block text-xs uppercase tracking-wide text-slate-400">{m.label}</label>
            <div className="mt-2 flex gap-2">
              <input
                name="target_value"
                type="number"
                step="any"
                defaultValue={latest(m.key, m.period) ?? ""}
                className="w-full rounded-md border border-charcoal-600 bg-charcoal-800 px-3 py-1.5 text-sm text-white"
              />
              <button className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500">Save</button>
            </div>
          </form>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white">Scorecard Weights</h2>
        <p className="text-sm text-slate-400">Must sum to 1.0 — enforced both here and by a database constraint.</p>
        <form action={updateScorecardWeights} className="mt-3 grid gap-3 rounded-xl border border-charcoal-700 bg-charcoal-900 p-4 sm:grid-cols-4">
          {[
            ["cash_collected_weight", "Cash Collected", weights?.cash_collected_weight ?? 0.25],
            ["close_rate_weight", "Close Rate", weights?.close_rate_weight ?? 0.2],
            ["avg_ticket_weight", "Avg Ticket", weights?.avg_ticket_weight ?? 0.15],
            ["follow_up_completion_weight", "Follow-up Completion", weights?.follow_up_completion_weight ?? 0.15],
            ["show_rate_weight", "Show Rate", weights?.show_rate_weight ?? 0.1],
            ["activity_target_weight", "Activity Target", weights?.activity_target_weight ?? 0.1],
            ["crm_data_accuracy_weight", "CRM Data Accuracy", weights?.crm_data_accuracy_weight ?? 0.05],
          ].map(([name, label, value]) => (
            <label key={name as string} className="text-xs text-slate-400">
              {label as string}
              <input
                name={name as string}
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={value as number}
                className="mt-1 w-full rounded-md border border-charcoal-600 bg-charcoal-800 px-2 py-1 text-sm text-white"
              />
            </label>
          ))}
          <button className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 sm:col-span-4">
            Save Weights
          </button>
        </form>
      </div>
    </div>
  );
}
