import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Real-time GoHighLevel webhook. NOT verified against a live GHL account —
 * GHL's outbound webhook payload shape depends on which workflow/automation
 * triggers it, so the exact field names here are a best-guess based on
 * common GHL webhook payloads and MUST be confirmed against this account's
 * actual webhook payload before going live (log one real payload during
 * setup — see docs/integration-setup-guide.md).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-webhook-secret");
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: "Invalid or missing webhook secret" }, { status: 401 });
  }

  const payload = await request.json();
  const supabase = createSupabaseServiceRoleClient();

  // TODO(verify): confirm the actual event/contact shape GHL sends for this
  // account's configured workflow before trusting this mapping.
  const contact = payload.contact ?? payload;
  if (!contact?.id) {
    return NextResponse.json({ error: "Payload missing contact id" }, { status: 400 });
  }

  await supabase.from("leads").upsert(
    {
      external_id: contact.id,
      source_platform: "gohighlevel",
      first_name: contact.firstName ?? contact.first_name ?? null,
      last_name: contact.lastName ?? contact.last_name ?? null,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      attribution_missing: !contact.source && !contact.attributionSource,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "source_platform,external_id" }
  );

  return NextResponse.json({ received: true });
}
