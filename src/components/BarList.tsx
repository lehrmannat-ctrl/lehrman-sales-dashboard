import { formatCents } from "@/lib/kpi";

export function BarList({ title, rows }: { title: string; rows: { label: string; valueCents: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.valueCents));
  const sorted = [...rows].sort((a, b) => b.valueCents - a.valueCents);

  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-white">{title}</h3>
      {sorted.length === 0 && <p className="text-xs text-slate-500">No data for this period.</p>}
      <div className="space-y-2">
        {sorted.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>{r.label}</span>
              <span className="text-slate-300">{formatCents(r.valueCents)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-charcoal-800">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(3, (r.valueCents / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
