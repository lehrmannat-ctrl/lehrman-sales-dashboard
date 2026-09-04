import type { IntegrationPlatform } from "@/types/database";

/**
 * Shared adapter contract. Every integration (GoHighLevel, Quo, Stripe,
 * Urable, Meta Ads) implements this the same way so the integration
 * settings page and the sync cron route can treat all five uniformly, and
 * so a sixth integration can be added later without touching the rest of
 * the app (see docs/integration-setup-guide.md).
 *
 * CONFIDENCE LEVELS (be honest with the owner about this):
 *   - stripe.ts is written against Stripe's stable, well-documented API and
 *     is the most likely to work close to as-written.
 *   - gohighlevel.ts / quo.ts / urable.ts / meta.ts are written from public
 *     documentation patterns but have NOT been executed against a live
 *     account (no credentials were available while building this). Each
 *     has TODO markers at the exact points that need verification against
 *     the current API version before flipping it live. Do not treat any of
 *     them as "connected" until docs/testing-checklist.md has been run.
 */

export type SyncStatus = "success" | "partial" | "failed" | "not_connected";

export interface SyncResult {
  status: SyncStatus;
  recordsSynced: number;
  errorMessage?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
}

export interface IntegrationAdapter {
  platform: IntegrationPlatform;
  /** True only if the required env vars are present. Never returns true by guessing. */
  isConfigured(): boolean;
  /** A cheap, read-only call that proves the credentials actually work. */
  testConnection(): Promise<ConnectionTestResult>;
  /** Pulls new/updated records since the last successful sync and upserts them. */
  sync(): Promise<SyncResult>;
}

export function envPresent(...names: string[]): boolean {
  return names.every((n) => !!process.env[n] && process.env[n]!.trim().length > 0);
}
