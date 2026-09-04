"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function resolveAlert(alertId: string) {
  const supabase = createSupabaseServerClient();
  await supabase.from("alerts").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", alertId);
  revalidatePath("/alerts");
}
