"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import clsx from "clsx";
import { formatCents } from "@/lib/kpi";
import type { PipelineStage } from "@/types/database";
import { updateOpportunityStage } from "@/app/(dashboard)/pipeline/actions";

export interface PipelineCardData {
  id: string;
  customerName: string;
  serviceName: string;
  estimatedValueCents: number;
  cashCollectedCents: number;
  stage: PipelineStage;
  sourceName: string | null;
  lostReason: string | null;
  appointmentDate: string | null;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  new_lead: "New Lead",
  attempting_contact: "Attempting Contact",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment_booked: "Appt. Booked",
  appointment_confirmed: "Appt. Confirmed",
  showed: "Showed",
  sold: "Sold",
  deposit_collected: "Deposit Collected",
  paid_in_full: "Paid in Full",
  job_completed: "Job Completed",
  review_requested: "Review Requested",
  follow_up_or_next_service_due: "Follow-Up Due",
  lost: "Lost",
};

const STAGES: PipelineStage[] = [
  "qualified", "appointment_booked", "appointment_confirmed", "showed", "sold",
  "deposit_collected", "paid_in_full", "job_completed", "review_requested", "lost",
];

function StageSelect({ opp }: { opp: PipelineCardData }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const newStage = e.target.value as PipelineStage;
    setError(null);
    startTransition(() => {
      // Server Actions can't be awaited directly inside startTransition's
      // callback (it must return void), so the promise is handled here and
      // any failure is shown inline instead of being silently dropped.
      updateOpportunityStage(opp.id, newStage).then((result) => {
        if (!result.ok) setError(result.error ?? "Failed to update stage.");
      });
    });
  }

  return (
    <div>
      <select
        defaultValue={opp.stage}
        disabled={isPending}
        onChange={handleChange}
        className="w-full rounded-md border border-charcoal-600 bg-charcoal-800 px-2 py-1 text-xs text-slate-200"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-status-bad">{error}</p>}
    </div>
  );
}

function Card({ opp }: { opp: PipelineCardData }) {
  return (
    <div className="rounded-lg border border-charcoal-700 bg-charcoal-900 p-3">
      <p className="text-sm font-medium text-white">{opp.customerName}</p>
      <p className="text-xs text-slate-400">{opp.serviceName}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
        <span>{formatCents(opp.estimatedValueCents)}</span>
        <span className="text-status-good">{formatCents(opp.cashCollectedCents)} collected</span>
      </div>
      {opp.sourceName && <p className="mt-1 text-[11px] text-slate-500">Source: {opp.sourceName}</p>}
      {opp.lostReason && <p className="mt-1 text-[11px] text-status-bad">Lost: {opp.lostReason}</p>}
      <div className="mt-2">
        <StageSelect opp={opp} />
      </div>
    </div>
  );
}

export function PipelineView({ opportunities }: { opportunities: PipelineCardData[] }) {
  const [view, setView] = useState<"kanban" | "table">("kanban");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["kanban", "table"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition",
              view === v ? "border-brand-500 bg-brand-600/20 text-brand-500" : "border-charcoal-700 text-slate-400 hover:text-white"
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((stage) => {
            const stageOpps = opportunities.filter((o) => o.stage === stage);
            return (
              <div key={stage} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{STAGE_LABELS[stage]}</h3>
                  <span className="text-xs text-slate-500">{stageOpps.length}</span>
                </div>
                <div className="space-y-2">
                  {stageOpps.map((o) => (
                    <Card key={o.id} opp={o} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-charcoal-700">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-charcoal-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Cash Collected</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-800">
              {opportunities.map((o) => (
                <tr key={o.id} className="text-slate-200">
                  <td className="px-4 py-3">{o.customerName}</td>
                  <td className="px-4 py-3">{o.serviceName}</td>
                  <td className="px-4 py-3">{formatCents(o.estimatedValueCents)}</td>
                  <td className="px-4 py-3">{formatCents(o.cashCollectedCents)}</td>
                  <td className="px-4 py-3">{o.sourceName ?? "—"}</td>
                  <td className="px-4 py-3 w-40"><StageSelect opp={o} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
