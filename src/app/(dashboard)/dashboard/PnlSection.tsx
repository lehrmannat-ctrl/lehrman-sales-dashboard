"use client";

import { useState } from "react";
import { formatCents, formatPercent } from "@/lib/kpi";
import type { PnlPeriod, SimplePnl } from "@/lib/queries";

const PERIOD_LABELS: Record<PnlPeriod, string> = {
  current_month: "Current month",
  previous_month: "Previous month",
  ytd: "Year to date",
};

const PERIODS: PnlPeriod[] = ["current_month", "previous_month", "ytd"];

/**
 * Deliberately simple P&L — 6 line items, no sub-ledgers, no accrual/cash
 * toggle, no chart-of-accounts drilldown. Sourced entirely from QuickBooks
 * (financial_snapshots, synced by src/lib/integrations/quickbooks.ts) — this
 * component only ever displays what's in that table, never estimates.
 */
export function PnlSection({ pnlByPeriod }: { pnlByPeriod: Record<PnlPeriod, SimplePnl | null> }) {
  const [period, setPeriod] = useState<PnlPeriod>("current_month");
  const pnl = pnlByPeriod[period];

  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">Profit &amp; Loss</h2>
          <p className="text-xs text-slate-500">From QuickBooks — see Settings → Integrations for sync status.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-charcoal-700 p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p ? "bg-brand-600/20 text-brand-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {!pnl ? (
        <p className="rounded-lg border border-charcoal-700 bg-charcoal-950 p-4 text-sm text-slate-500">
          Not synced yet for {PERIOD_LABELS[period].toLowerCase()} — connect QuickBooks in Settings → Integrations to
          populate this.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <tbody className="divide-y divide-charcoal-800">
              <Row label="Revenue" value={formatCents(pnl.revenueCents)} />
              <Row label="Supplies" value={`(${formatCents(pnl.suppliesCents)})`} />
              <Row label="Labor" value={`(${formatCents(pnl.laborCents)})`} />
              <Row label="Marketing" value={`(${formatCents(pnl.marketingCents)})`} />
              <Row label="Rent" value={`(${formatCents(pnl.rentCents)})`} />
              <Row label="Other" value={`(${formatCents(pnl.otherCents)})`} />
              <Row label="Total Expenses" value={`(${formatCents(pnl.totalExpensesCents)})`} bold />
              <Row
                label="Profit"
                value={formatCents(pnl.profitCents)}
                bold
                valueClassName={pnl.profitCents >= 0 ? "text-status-good" : "text-status-bad"}
              />
              <Row
                label="Profit Margin"
                value={pnl.profitMarginPct === null ? "—" : formatPercent(pnl.profitMarginPct)}
                bold
              />
            </tbody>
          </table>
          {pnl.syncedAt && (
            <p className="mt-2 text-xs text-slate-600">Last synced {new Date(pnl.syncedAt).toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <tr>
      <td className={`py-2 pr-4 ${bold ? "font-semibold text-white" : "text-slate-300"}`}>{label}</td>
      <td className={`py-2 text-right tabular-nums ${bold ? "font-semibold text-white" : "text-slate-200"} ${valueClassName ?? ""}`}>
        {value}
      </td>
    </tr>
  );
}
