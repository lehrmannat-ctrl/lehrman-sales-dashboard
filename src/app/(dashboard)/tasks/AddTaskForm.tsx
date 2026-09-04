"use client";

import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import type { TaskPickerLead } from "@/lib/queries";
import { createManualFollowUpTask } from "./actions";

/** Default due time for a newly-added task: tomorrow at 9am, in the browser's local time. */
function defaultDueValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddTaskForm({ leads }: { leads: TaskPickerLead[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<TaskPickerLead | null>(null);
  const [dueAt, setDueAt] = useState(defaultDueValue());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || selectedLead) return [];
    return leads.filter((l) => l.name.toLowerCase().includes(q) || l.phone?.includes(q)).slice(0, 8);
  }, [search, selectedLead, leads]);

  function reset() {
    setSearch("");
    setSelectedLead(null);
    setDueAt(defaultDueValue());
    setNote("");
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    setSuccessNote(null);
    if (!selectedLead) {
      setError("Pick a customer from the list first.");
      return;
    }
    if (!note.trim()) {
      setError("Add a short note about what this task is.");
      return;
    }
    const dueAtDate = new Date(dueAt);
    if (Number.isNaN(dueAtDate.getTime())) {
      setError("That due date/time isn't valid.");
      return;
    }

    startTransition(() => {
      createManualFollowUpTask({ leadId: selectedLead.id, dueAt: dueAtDate.toISOString(), note: note.trim() }).then(
        (result) => {
          if (!result.ok) {
            setError(result.error ?? "Couldn't add that task.");
            return;
          }
          setSuccessNote(
            result.movedToMonday
              ? "Added — moved to Monday since the shop's closed Sundays."
              : "Added."
          );
          reset();
          setOpen(false);
        }
      );
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setSuccessNote(null);
            setOpen(true);
          }}
          className="rounded-md border border-charcoal-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-charcoal-500 hover:text-white"
        >
          + Add a task
        </button>
        {successNote && <span className="text-xs text-status-good">{successNote}</span>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-900 p-4 text-xs">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-white">Add a task</p>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-slate-500 hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <p className="mb-1 text-slate-500">Customer</p>
          {selectedLead ? (
            <div className="flex items-center justify-between rounded-md border border-charcoal-600 bg-charcoal-950 px-2 py-1.5">
              <span className="text-slate-200">
                {selectedLead.name}
                {selectedLead.phone ? ` · ${selectedLead.phone}` : ""}
              </span>
              <button type="button" onClick={() => setSelectedLead(null)} className="text-slate-500 hover:text-white">
                change
              </button>
            </div>
          ) : (
            <>
              <input
                value={search}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="w-full rounded-md border border-charcoal-600 bg-charcoal-950 px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
              />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-charcoal-600 bg-charcoal-900 shadow-lg">
                  {matches.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setSelectedLead(l);
                        setSearch("");
                      }}
                      className="block w-full px-2 py-1.5 text-left text-slate-200 hover:bg-charcoal-800"
                    >
                      {l.name}
                      {l.phone ? ` · ${l.phone}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <p className="mb-1 text-slate-500">Due</p>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDueAt(e.target.value)}
            className="w-full rounded-md border border-charcoal-600 bg-charcoal-950 px-2 py-1.5 text-slate-200"
          />
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1 text-slate-500">What's this task?</p>
          <textarea
            value={note}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
            placeholder="e.g. Call back about the ceramic coating quote she asked for"
            rows={2}
            className="w-full rounded-md border border-charcoal-600 bg-charcoal-950 px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-status-bad">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSubmit}
          className="rounded-md border border-brand-500 bg-brand-600/20 px-3 py-1.5 font-medium text-brand-500 hover:bg-brand-600/30 disabled:opacity-40"
        >
          {isPending ? "Adding…" : "Add task"}
        </button>
      </div>
    </div>
  );
}
