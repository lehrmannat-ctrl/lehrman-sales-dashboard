"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { StatusPill } from "@/components/StatusPill";
import type { FollowUpTaskRow } from "@/lib/queries";
import { completeFollowUpTask, skipFollowUpTask, updateLeadVehicle } from "./actions";

const STAGE_LABELS: Record<string, string> = {
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  completed: { label: "Called", className: "border-status-good/40 bg-status-good/15 text-status-good" },
  skipped: { label: "Skipped", className: "border-charcoal-600 bg-charcoal-800 text-slate-400" },
  canceled: { label: "Canceled", className: "border-charcoal-600 bg-charcoal-800 text-slate-500" },
};

/** `task.note` (a manually-added task, migrations 0015) always wins over trying to describe a cadence rule that doesn't exist for it. */
function describeTask(task: FollowUpTaskRow): string {
  if (task.cadence_rule === "manual") return task.note?.trim() || "Manually added task";
  return describeCadence(task.cadence_rule);
}

function describeCadence(rule: string): string {
  if (rule === "new_lead_contact") return "New lead — make first contact";

  const initial = rule.match(/^initial_contact_day(\d+)_(am|pm)$/);
  if (initial) {
    const [, day, ampm] = initial;
    return `Initial contact call-back — day ${day} (${ampm === "am" ? "morning" : "afternoon"})`;
  }

  const recall = rule.match(/^(hot|warm|cold)_recall_day(\d+)$/);
  if (recall) {
    const [, temp, day] = recall;
    const label = temp.charAt(0).toUpperCase() + temp.slice(1);
    return `${label} lead recall — ${day} day check-in`;
  }

  return rule.replace(/_/g, " ");
}

export function TaskRow({ task }: { task: FollowUpTaskRow }) {
  const [expanded, setExpanded] = useState(false);
  const [vehicle, setVehicle] = useState(task.lead_vehicle ?? "");
  const [vehicleSaved, setVehicleSaved] = useState(task.lead_vehicle ?? "");
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const overdue = task.status === "pending" && new Date(task.due_at).getTime() < Date.now();
  const vehicleDirty = vehicle !== vehicleSaved;
  const statusBadge = STATUS_BADGE[task.status];

  function saveVehicle() {
    setVehicleError(null);
    startTransition(() => {
      updateLeadVehicle(task.lead_id, vehicle).then((result) => {
        if (!result.ok) setVehicleError(result.error ?? "Couldn't save that.");
        else setVehicleSaved(vehicle);
      });
    });
  }

  // Plain onClick (not <form action>) because these run from a client
  // component - unlike a Server Component's <form action>, the form-action
  // typing here requires a function returning void, but these actions
  // return { ok, error } so the caller can surface a failure. Same fix as
  // PipelineView.tsx's StageSelect.
  function handleSkip() {
    setTaskActionError(null);
    startTransition(() => {
      skipFollowUpTask(task.id).then((result) => {
        if (!result.ok) setTaskActionError(result.error ?? "Couldn't skip that.");
      });
    });
  }

  function handleComplete() {
    setTaskActionError(null);
    startTransition(() => {
      completeFollowUpTask(task.id).then((result) => {
        if (!result.ok) setTaskActionError(result.error ?? "Couldn't mark that called.");
      });
    });
  }

  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            {overdue && (
              <span className="rounded-full border border-status-bad/40 bg-status-bad/15 px-2 py-0.5 text-xs font-medium text-status-bad">
                Overdue
              </span>
            )}
            <span className="text-xs text-slate-500">
              {task.status === "completed" && task.completed_at
                ? `Called ${new Date(task.completed_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                : `Due ${new Date(task.due_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
            </span>
          </div>
          <p className="text-sm text-white">{describeTask(task)}</p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-brand-400 underline decoration-dotted underline-offset-2 hover:text-brand-300"
          >
            {task.lead_name}
            {task.lead_phone ? ` · ${task.lead_phone}` : ""}
            <span className="ml-1 text-slate-500">{expanded ? "▲ hide profile" : "▼ view profile"}</span>
          </button>
        </div>
        {task.status === "pending" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={handleSkip}
              className="rounded-md border border-charcoal-600 px-3 py-1.5 text-xs text-slate-300 hover:border-charcoal-500 disabled:opacity-40"
            >
              Skip
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleComplete}
              className="rounded-md border border-status-good/40 bg-status-good/15 px-3 py-1.5 text-xs font-medium text-status-good hover:bg-status-good/25 disabled:opacity-40"
            >
              Mark called
            </button>
          </div>
        ) : (
          statusBadge && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          )
        )}
      </div>
      {taskActionError && <p className="mt-1 text-xs text-status-bad">{taskActionError}</p>}

      {expanded && (
        <div className="mt-3 space-y-3 rounded-lg border border-charcoal-700 bg-charcoal-950 p-3 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <div>
              <p className="text-slate-500">Phone</p>
              <p className="text-slate-200">{task.lead_phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-500">Email</p>
              <p className="text-slate-200">{task.lead_email ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-500">Stage</p>
              <StatusPill value={task.lead_stage} label={STAGE_LABELS[task.lead_stage] ?? task.lead_stage} />
            </div>
            <div>
              <p className="text-slate-500">Temperature</p>
              <StatusPill value={task.lead_temperature} />
            </div>
            <div>
              <p className="text-slate-500">Wants to book</p>
              <p className="text-slate-200">{task.lead_requested_booking_timeframe ?? "Not on file"}</p>
            </div>
          </div>

          <div>
            <p className="mb-1 text-slate-500">Vehicle</p>
            <div className="flex items-center gap-2">
              <input
                value={vehicle}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setVehicle(e.target.value)}
                placeholder="e.g. 2019 Ford F-150, black"
                className="w-full max-w-xs rounded-md border border-charcoal-600 bg-charcoal-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
              />
              <button
                type="button"
                disabled={!vehicleDirty || isPending}
                onClick={saveVehicle}
                className="rounded-md border border-charcoal-600 px-2 py-1 text-slate-300 hover:border-charcoal-500 disabled:opacity-40"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            </div>
            {vehicleError && <p className="mt-1 text-status-bad">{vehicleError}</p>}
          </div>

          <div>
            <p className="mb-1 text-slate-500">What we know from calls</p>
            {task.lead_ai_notes ? (
              <>
                <p className="whitespace-pre-wrap text-slate-300">{task.lead_ai_notes}</p>
                {task.lead_ai_notes_updated_at && (
                  <p className="mt-1 text-slate-600">
                    Updated {new Date(task.lead_ai_notes_updated_at).toLocaleDateString()}
                  </p>
                )}
              </>
            ) : (
              <p className="text-slate-400">
                Nothing yet — click &quot;Sync call summaries&quot; on Settings → Integrations after a call happens,
                and notes on their vehicle, interests, timing, and objections will show up here automatically.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
