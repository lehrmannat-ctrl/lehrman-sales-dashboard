import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange, type DateRangePreset } from "@/lib/date-ranges";
import { getRevenueBreakdown } from "@/lib/queries";
import { formatCents } from "@/lib/kpi";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { BarList } from "@/components/BarList";

export const dynamic = "force-dynamic";

function StatBlock({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const toneClass = tone === "good" ? "text-status-good" : tone === "bad" ? "text-status-bad" : "text-white";
  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default async function RevenuePage({ searchParams }: { searchParams: { range?: string } }) {
  const preset = (searchParams.range as DateRangePreset) ?? "this_month";
  const range = resolveDateRange(preset);
  const supabase = createSupabaseServerClient();
  const rev = await getRevenueBreakdown(supabase, range);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Revenue &amp; Cash</h1>
          <p className="text-sm text-slate-400">Six numbers, never merged. See docs/kpi-dictionary.md for exact formulas.</p>
        </div>
        <DateRangeFilter current={preset} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatBlock label="Revenue Sold" value={formatCents(rev.revenueSoldCents)} />
        <StatBlock label="Cash Collected" value={formatCents(rev.cashCollectedCents)} tone="good" />
        <StatBlock label="Deposits Collected" value={formatCents(rev.depositsCollectedCents)} />
        <StatBlock label="Outstanding A/R" value={formatCents(Math.max(0, rev.revenueSoldCents - rev.cashCollectedCents))} tone="bad" />
        <StatBlock label="Completed-Job Revenue" value={formatCents(rev.completedJobRevenueCents)} />
        <StatBlock label="Refunded / Canceled" value={formatCents(rev.refundedCents)} tone={rev.refundedCents > 0 ? "bad" : "neutral"} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <BarList title="Revenue Sold by Service" rows={rev.byService.map((s) => ({ label: s.label, valueCents: s.revenueSoldCents }))} />
        <BarList title="Revenue Sold by Salesperson" rows={rev.bySalesperson.map((s) => ({ label: s.label, valueCents: s.revenueSoldCents }))} />
        <BarList title="Revenue Sold by Lead Source" rows={rev.bySource.map((s) => ({ label: s.label, valueCents: s.revenueSoldCents }))} />
      </div>
    </div>
  );
}
