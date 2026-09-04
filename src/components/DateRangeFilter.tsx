"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { DATE_RANGE_LABELS, type DateRangePreset } from "@/lib/date-ranges";

const PRESETS: DateRangePreset[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"];

/** Reads/writes the `range` query param so every page's date filter is a shareable, bookmarkable URL. */
export function DateRangeFilter({ current }: { current: DateRangePreset }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setPreset(preset: DateRangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", preset);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset}
          onClick={() => setPreset(preset)}
          className={clsx(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            current === preset
              ? "border-brand-500 bg-brand-600/20 text-brand-500"
              : "border-charcoal-700 text-slate-400 hover:border-charcoal-600 hover:text-white"
          )}
        >
          {DATE_RANGE_LABELS[preset]}
        </button>
      ))}
    </div>
  );
}
