import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange, type DateRangePreset } from "@/lib/date-ranges";
import { getLeadSourceReport } from "@/lib/queries";
import { showRate, closeRate, customerAcquisitionCost, returnOnAdSpend, cashReturnOnAdSpend, formatCents, formatPercent } from "@/lib/kpi";
import { DateRangeFilter } from "@/components/DateRangeFilter";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: { range?: string } }) {
  const preset = (searchParams.range as DateRangePreset) ?? "this_month";
  const range = resolveDateRange(preset);
  const supabase = createSupabaseServerClient();
  const rows = await getLeadSourceReport(supabase, range);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Lead Source Reporting</h1>
          <p className="text-sm text-slate-400">Cost per lead, ROAS, and CROAS require ad spend AND CRM attribution to both be connected and accurate.</p>
        </div>
        <DateRangeFilter current={preset} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-charcoal-700">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Missing Attribution</th>
              <th className="px-4 py-3">Ad Spend</th>
              <th className="px-4 py-3">Cost / Lead</th>
              <th className="px-4 py-3">Appts Booked</th>
              <th className="px-4 py-3">Show Rate</th>
              <th className="px-4 py-3">Close Rate</th>
              <th className="px-4 py-3">Revenue Sold</th>
              <th className="px-4 py-3">Cash Collected</th>
              <th className="px-4 py-3">CAC</th>
              <th className="px-4 py-3">ROAS</th>
              <th className="px-4 py-3">Cash ROAS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-800">
            {rows.map((r) => (
              <tr key={r.sourceName} className="text-slate-200">
                <td className="px-4 py-3 font-medium text-white">
                  {r.sourceName}
                  {r.missingAttributionCount > 0 && r.sourceName === "Unknown" && (
                    <span className="ml-2 rounded-full bg-status-warn/15 px-2 py-0.5 text-[10px] text-status-warn">flagged</span>
                  )}
                </td>
                <td className="px-4 py-3">{r.leads}</td>
                <td className="px-4 py-3">{r.missingAttributionCount}</td>
                <td className="px-4 py-3">{formatCents(r.adSpendCents)}</td>
                <td className="px-4 py-3">{r.leads > 0 ? formatCents(r.adSpendCents / r.leads) : "—"}</td>
                <td className="px-4 py-3">{r.appointmentsBooked}</td>
                <td className="px-4 py-3">{formatPercent(showRate(r.appointmentsShowed, r.appointmentsBooked))}</td>
                <td className="px-4 py-3">{formatPercent(closeRate(r.dealsClosed, r.appointmentsShowed))}</td>
                <td className="px-4 py-3">{formatCents(r.revenueSoldCents)}</td>
                <td className="px-4 py-3">{formatCents(r.cashCollectedCents)}</td>
                <td className="px-4 py-3">{r.dealsClosed > 0 ? formatCents(customerAcquisitionCost(r.adSpendCents, r.dealsClosed)) : "—"}</td>
                <td className="px-4 py-3">{r.adSpendCents > 0 ? `${returnOnAdSpend(r.revenueSoldCents, r.adSpendCents).toFixed(2)}x` : "—"}</td>
                <td className="px-4 py-3">{r.adSpendCents > 0 ? `${cashReturnOnAdSpend(r.cashCollectedCents, r.adSpendCents).toFixed(2)}x` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
