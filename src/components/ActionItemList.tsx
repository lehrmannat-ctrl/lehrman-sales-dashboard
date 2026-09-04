import { formatCents } from "@/lib/kpi";
import type { ActionItem } from "@/lib/queries";

export function ActionItemList({ title, items, emptyLabel }: { title: string; items: ActionItem[]; emptyLabel: string }) {
  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <span className="rounded-full bg-charcoal-800 px-2 py-0.5 text-xs text-slate-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-charcoal-800 bg-charcoal-950 px-3 py-2">
              <div>
                <p className="text-sm text-white">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {item.stage.replace(/_/g, " ")}
                  {item.opportunityValueCents ? ` · ${formatCents(item.opportunityValueCents)}` : ""}
                  {item.nextTask ? ` · ${item.nextTask}` : ""}
                </p>
              </div>
              {item.phone && (
                <div className="flex gap-2">
                  <a href={`tel:${item.phone}`} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500">Call</a>
                  <a href={`sms:${item.phone}`} className="rounded-md border border-charcoal-600 px-2.5 py-1 text-xs text-slate-200 hover:border-charcoal-500">Text</a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
