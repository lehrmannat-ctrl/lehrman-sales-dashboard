"use server";

import { revalidatePath } from "next/cache";
import { runSync } from "@/lib/integrations/registry";
import { syncCallSummaries } from "@/lib/integrations/call-summaries";
import type { IntegrationPlatform } from "@/types/database";

export async function manualResync(platform: IntegrationPlatform) {
  await runSync(platform);
  revalidatePath("/settings/integrations");
}

/**
 * Manually triggered, not run automatically on every regular resync - each
 * call summary costs a small amount of real money (OpenAI transcription +
 * summarization), so the owner should choose when this runs rather than it
 * happening silently in the background.
 */
export async function syncCallSummariesNow() {
  const result = await syncCallSummaries();
  revalidatePath("/settings/integrations");
  revalidatePath("/tasks");
  return result;
}
