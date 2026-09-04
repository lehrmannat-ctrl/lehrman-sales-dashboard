import clsx from "clsx";
import type { KpiResult } from "@/lib/kpi";
import { formatCents, formatPercent } from "@/lib/kpi";

const STATUS_STYLES: Record<KpiResult["status"], string> = {
  good: "border-status-good/40 bg-status-good/10 text-status-good",
  warn: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  bad: "border-status-bad/40 bg-status-bad/10 text-status-bad",
  no_goal: "border-charcoal-600 bg-charcoal-800 text-slate-400",
};

function formatValue(value: number, format: KpiResult["format"]): string {
  switch (format) {
    case "currency":
      return formatCents(value);
    case "percent":
      return formatPercent(value);
    case "minutes":
      return `${value.toFixed(0)} min`;
    default:
      return value.toLocaleString("en-US");
  }
}

export function KpiCard({ kpi, href }: { kpi: KpiResult; href?: string }) {
  const body = (
    <div className="flex h-full flex-col justify-between rounded-xl border border-charcoal-700 bg-charcoal-900 p-4 transition hover:border-charcoal-600">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{kpi.label}</span>
        <span className={clsx("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLES[kpi.status])}>
          {kpi.status === "no_goal" ? "No Goal" : kpi.status}
        </span>
      </div>

      <div className="mt-2 text-2xl font-semibold text-white">{formatValue(kpi.current, kpi.format)}</div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{kpi.goal !== null ? `Goal: ${formatValue(kpi.goal, kpi.format)}` : "No goal set"}</span>
        {kpi.percentChangeVsPrevPeriod !== null && (
          <span className={kpi.percentChangeVsPrevPeriod >= 0 ? "text-status-good" : "text-status-bad"}>
            {kpi.percentChangeVsPrevPeriod >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(kpi.percentChangeVsPrevPeriod))}
          </span>
        )}
      </div>
    </div>
  );

  if (!href) return body;
  return (
    <a href={href} className="block h-full">
      {body}
    </a>
  );
}
