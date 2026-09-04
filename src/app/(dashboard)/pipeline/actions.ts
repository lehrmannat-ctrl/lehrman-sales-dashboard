"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PipelineStage } from "@/types/database";

/**
 * Moves an opportunity to a new stage. RLS (0002_rls.sql) enforces that a
 * sales_associate can only update their own opportunities — this action
 * does not duplicate that check, it relies on the database to refuse the
 * write outright for anything out of scope, which is the point of having
 * RLS as the enforcement layer rather than just a UI convenience.
 *
 * The stage_history trigger (0003_functions_triggers.sql) logs this
 * transition automatically — no manual audit_log write is needed here for
 * the stage change itself.
 */
export async function updateOpportunityStage(opportunityId: string, newStage: PipelineStage) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("opportunities").update({ stage: newStage }).eq("id", opportunityId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/funnel");
  return { ok: true };
}
