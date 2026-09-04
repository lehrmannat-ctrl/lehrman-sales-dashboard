"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { TASK_STATUS_FILTERS, TASK_STATUS_FILTER_LABELS } from "@/lib/task-status-filters";
import type { FollowUpTaskFilter } from "@/lib/queries";

/** Reads/writes the `status` query param - which follow_up_tasks statuses show up. Defaults to "pending" when absent. */
export function StatusFilterBar({ current }: { current: FollowUpTaskFilter }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setStatus(status: FollowUpTaskFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (status === "pending") {
      params.delete("status");
    } else {
      params.set("status", status);
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TASK_STATUS_FILTERS.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => setStatus(status)}
          className={clsx(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            current === status
              ? "border-brand-500 bg-brand-600/20 text-brand-500"
              : "border-charcoal-700 text-slate-400 hover:border-charcoal-600 hover:text-white"
          )}
        >
          {TASK_STATUS_FILTER_LABELS[status]}
        </button>
      ))}
    </div>
  );
}
