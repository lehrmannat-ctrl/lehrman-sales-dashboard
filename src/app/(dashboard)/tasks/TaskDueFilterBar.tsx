"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { TASK_DUE_FILTERS, TASK_DUE_FILTER_LABELS, type TaskDueFilter } from "@/lib/task-due-filters";

/** Reads/writes the `due` query param, matching the pattern DateRangeFilter uses for `range` elsewhere in the app. */
export function TaskDueFilterBar({ current }: { current: TaskDueFilter }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setFilter(filter: TaskDueFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") {
      params.delete("due");
    } else {
      params.set("due", filter);
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TASK_DUE_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => setFilter(filter)}
          className={clsx(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            current === filter
              ? "border-brand-500 bg-brand-600/20 text-brand-500"
              : "border-charcoal-700 text-slate-400 hover:border-charcoal-600 hover:text-white"
          )}
        >
          {TASK_DUE_FILTER_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}
