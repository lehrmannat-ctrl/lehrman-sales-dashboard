"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Marks a follow-up task done. RLS (followup_assoc_update, 0002_rls.sql)
 * already refuses this for a task that isn't assigned to the caller (or, for
 * the owner, any task) - this action doesn't duplicate that check.
 */
export async function completeFollowUpTask(taskId: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("follow_up_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/tasks");
  return { ok: true };
}

/** Skips a task without pretending it was actually done - kept separate from "completed" so the scorecard's followUpsCompleted count stays honest. */
export async function skipFollowUpTask(taskId: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("follow_up_tasks").update({ status: "skipped" }).eq("id", taskId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Saves the vehicle note typed into a lead's customer-profile panel
 * (supabase/migrations/0012 - a plain free-text column on `leads`, not
 * pulled from any integration yet). RLS (leads_assoc_update, 0002_rls.sql)
 * already refuses this for a lead not assigned to the caller.
 */
export async function updateLeadVehicle(leadId: string, vehicle: string) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("leads")
    .update({ vehicle: vehicle.trim() || null })
    .eq("id", leadId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Lets someone add their own follow-up task, not just the ones the cadence
 * triggers generate (supabase/migrations/0015). Always assigned to whoever
 * is adding it - RLS's new followup_assoc_insert policy only allows
 * inserting a task with assigned_to = auth.uid() for a sales_associate (the
 * owner's followup_owner_all policy allows anything), so there's no way to
 * hand a task to someone else from here.
 *
 * cadence_rule is fixed to 'manual' so the UI can tell "typed in by a
 * person" apart from an automatic cadence task and show `note` instead of
 * trying to describe a cadence rule that doesn't exist. The table's
 * follow_up_not_on_sunday check constraint means a Sunday due date has to
 * be moved, not just rejected - same one-day push the automatic cadence
 * uses, and we tell the caller it happened.
 */
export async function createManualFollowUpTask(input: { leadId: string; dueAt: string; note: string }) {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to add a task." };
  }

  const note = input.note.trim();
  if (!note) {
    return { ok: false, error: "Add a short note about what this task is." };
  }
  if (!input.leadId) {
    return { ok: false, error: "Pick a customer for this task." };
  }

  const parsedDueAt = new Date(input.dueAt);
  if (Number.isNaN(parsedDueAt.getTime())) {
    return { ok: false, error: "That due date/time isn't valid." };
  }

  let movedToMonday = false;
  if (parsedDueAt.getDay() === 0) {
    parsedDueAt.setDate(parsedDueAt.getDate() + 1);
    movedToMonday = true;
  }

  const { error } = await supabase.from("follow_up_tasks").insert({
    lead_id: input.leadId,
    assigned_to: user.id,
    created_by: user.id,
    due_at: parsedDueAt.toISOString(),
    cadence_rule: "manual",
    note,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/tasks");
  return { ok: true, movedToMonday };
}
