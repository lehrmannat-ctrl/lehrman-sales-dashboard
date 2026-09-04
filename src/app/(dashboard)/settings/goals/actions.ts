"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Goal } from "@/types/database";

/**
 * Upserts a goal (owner-only — RLS refuses this write for a sales_associate
 * session outright). This is how "targets must be editable without
 * changing code" is satisfied: it's a table row, not a constant in source.
 */
export async function setGoal(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const metricKey = String(formData.get("metric_key"));
  const period = String(formData.get("period")) as Goal["period"];
  const targetValue = Number(formData.get("target_value"));

  await supabase.from("goals").insert({
    metric_key: metricKey,
    period,
    scope: "company",
    target_value: targetValue,
    effective_date: new Date().toISOString().slice(0, 10),
    created_by: user?.id,
  });

  revalidatePath("/settings/goals");
  revalidatePath("/dashboard");
  revalidatePath("/forecast");
}

export async function updateScorecardWeights(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const weights = {
    cash_collected_weight: Number(formData.get("cash_collected_weight")),
    close_rate_weight: Number(formData.get("close_rate_weight")),
    avg_ticket_weight: Number(formData.get("avg_ticket_weight")),
    follow_up_completion_weight: Number(formData.get("follow_up_completion_weight")),
    show_rate_weight: Number(formData.get("show_rate_weight")),
    activity_target_weight: Number(formData.get("activity_target_weight")),
    crm_data_accuracy_weight: Number(formData.get("crm_data_accuracy_weight")),
  };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`Scorecard weights must sum to 1.0 (currently ${sum.toFixed(3)}). The database will also reject this — see the weights_sum_to_one constraint.`);
  }

  await supabase.from("scorecard_weights").insert({ ...weights, updated_by: user?.id });
  revalidatePath("/settings/goals");
  revalidatePath("/scorecards");
}
