"use client";

import { useState, useTransition } from "react";
import { syncCallSummariesNow } from "./actions";
import type { CallSummarySyncResult } from "@/lib/integrations/call-summaries";

export function CallSummarySync({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<CallSummarySyncResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setResult(null);
    startTransition(() => {
      syncCallSummariesNow().then(setResult);
    });
  }

  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">Call summaries (AI)</p>
          <p className="mt-1 text-xs text-slate-500">
            {configured
              ? "Reads real call recordings from your GoHighLevel account (616-427-1814) and summarizes what came up on each call. Costs a small amount per call (OpenAI transcription + summary)."
              : "Not set up yet — needs an OPENAI_API_KEY in .env.local. Ask Claude for the steps to get one."}
          </p>
        </div>
        <button
          disabled={!configured || isPending}
          onClick={handleClick}
          className="rounded-md border border-charcoal-600 px-3 py-1.5 text-xs text-slate-200 hover:border-charcoal-500 disabled:opacity-40"
        >
          {isPending ? "Summarizing…" : "Sync call summaries"}
        </button>
      </div>
      {result && (
        <div className="mt-3 rounded-lg border border-charcoal-700 bg-charcoal-950 p-3 text-xs">
          <p className="text-slate-300">
            {result.callsProcessed} call{result.callsProcessed === 1 ? "" : "s"} summarized, {result.leadsUpdated}{" "}
            lead{result.leadsUpdated === 1 ? "" : "s"} updated.
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1 text-status-bad">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {result.errors.length > 5 && <li>+{result.errors.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
