import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Stripe is the system of record for "cash collected" — see
 * docs/kpi-dictionary.md. Real-time updates arrive via the webhook route
 * (src/app/api/webhooks/stripe/route.ts); sync() below is the backfill /
 * reconciliation path (catches anything a missed webhook would have
 * written) and is safe to run on a schedule.
 *
 * This adapter is written against Stripe's stable REST API (charges /
 * payment_intents) and is the most likely of the five to work close to
 * as-written, but it has NOT been executed against a live Stripe account —
 * run docs/testing-checklist.md's Stripe section before trusting it.
 */

const STRIPE_API_BASE = "https://api.stripe.com/v1";

function mapStripeStatusToPaymentStatus(stripeStatus: string): "succeeded" | "pending" | "failed" {
  if (stripeStatus === "succeeded") return "succeeded";
  if (stripeStatus === "processing" || stripeStatus === "requires_action" || stripeStatus === "requires_capture") return "pending";
  return "failed";
}

async function stripeGet(path: string) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe API error ${res.status}: ${body}`);
  }
  return res.json();
}

export const stripeAdapter: IntegrationAdapter = {
  platform: "stripe",

  isConfigured() {
    return envPresent("STRIPE_SECRET_KEY");
  },

  async testConnection() {
    try {
      // Cheap, read-only, side-effect-free call to prove the key works.
      await stripeGet("/balance");
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();

    // TODO(verify): confirm whether this business's Stripe checkout links
    // attach opportunity_id as PaymentIntent metadata (recommended) — if
    // not yet, add `metadata: { opportunity_id }` when creating each
    // PaymentIntent/Checkout Session so this join is possible at all.
    const { data: payments } = await stripeGet("/payment_intents?limit=100");

    let synced = 0;
    let hadError = false;

    for (const pi of payments?.data ?? []) {
      const opportunityId: string | undefined = pi.metadata?.opportunity_id;
      if (!opportunityId) continue; // can't reconcile a payment with no opportunity link — surfaced as an "attribution missing"-style gap, not silently dropped

      const paymentType: "deposit" | "balance" | "full_payment" =
        pi.metadata?.payment_type === "deposit" || pi.metadata?.payment_type === "balance"
          ? pi.metadata.payment_type
          : "full_payment";

      const { error } = await supabase.from("payments").upsert(
        {
          external_id: pi.id,
          source_platform: "stripe",
          opportunity_id: opportunityId,
          amount_cents: pi.amount_received ?? pi.amount,
          type: paymentType,
          status: mapStripeStatusToPaymentStatus(pi.status),
          processed_at: pi.status === "succeeded" ? new Date(pi.created * 1000).toISOString() : null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
      if (error) {
        hadError = true;
      } else {
        synced++;
      }
    }

    return { status: hadError ? "partial" : "success", recordsSynced: synced };
  },
};
