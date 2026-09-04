import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Real-time Stripe webhook — this is what actually keeps "cash collected"
 * current, rather than waiting on the periodic sync in
 * src/lib/integrations/stripe.ts. Configure this URL in the Stripe
 * dashboard for payment_intent.succeeded / payment_intent.payment_failed /
 * charge.refunded (see docs/integration-setup-guide.md).
 *
 * Signature verification uses Stripe's documented HMAC scheme directly
 * (no `stripe` npm package dependency) so this route has no extra install
 * step beyond what's already in package.json.
 */

async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not configured" }, { status: 500 });
  }
  const valid = await verifyStripeSignature(rawBody, signature, secret);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const supabase = createSupabaseServiceRoleClient();

  // TODO(verify): confirm this account's exact metadata keys once Stripe
  // Checkout / PaymentIntents are wired to include opportunity_id and
  // payment_type — see src/lib/integrations/stripe.ts's matching TODO.
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const pi = event.data.object;
    const opportunityId = pi.metadata?.opportunity_id;
    if (opportunityId) {
      await supabase.from("payments").upsert(
        {
          external_id: pi.id,
          source_platform: "stripe",
          opportunity_id: opportunityId,
          amount_cents: pi.amount_received ?? pi.amount,
          type: pi.metadata?.payment_type === "deposit" || pi.metadata?.payment_type === "balance" ? pi.metadata.payment_type : "full_payment",
          status: event.type === "payment_intent.succeeded" ? "succeeded" : "failed",
          processed_at: event.type === "payment_intent.succeeded" ? new Date().toISOString() : null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
    }
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const opportunityId = charge.metadata?.opportunity_id;
    if (opportunityId) {
      await supabase.from("payments").upsert(
        {
          external_id: `refund_${charge.id}`,
          source_platform: "stripe",
          opportunity_id: opportunityId,
          amount_cents: charge.amount_refunded,
          type: "refund",
          status: "succeeded",
          processed_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );
    }
  }

  return NextResponse.json({ received: true });
}
