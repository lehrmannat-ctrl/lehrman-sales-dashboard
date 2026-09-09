import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { envPresent, type IntegrationAdapter, type SyncResult } from "./types";

/**
 * Urable is the system of record for scheduling AND for money collected —
 * Nathaniel confirmed every payment (card via Urable's own embedded Stripe,
 * cash, and checks) is recorded in Urable itself, so this adapter is the
 * ONLY source of "cash actually collected" for this business. There is no
 * separate Stripe integration (see docs/marketing-attribution.md's history
 * and the 2026-09-04 architecture note in the Claude project) — building
 * one would have only captured card payments and silently under-reported
 * every cash/check job.
 *
 * VERIFIED against Nathaniel's live account on 2026-09-04 (previous
 * versions of this file were an unverified best guess — every field below
 * is now confirmed real, not a TODO). Reference: the real OpenAPI spec at
 * https://app.urable.com/docs/openapi.yaml (the docs SITE lives at
 * api.urable.com, but that's just a static viewer — the real API and spec
 * are both served from app.urable.com).
 *
 * Key corrections from the old guessed version:
 *   - There is NO account id concept. A scoped API key alone identifies the
 *     account — URABLE_ACCOUNT_ID does not exist and has been removed.
 *   - Auth is `Authorization: Bearer <key>` (or `x-api-key: <key>`) against
 *     https://app.urable.com/api.
 *   - Money is already integer cents. Timestamps are Unix epoch
 *     milliseconds (not seconds, not ISO strings).
 *   - The API key needs these scopes: customers:read, items:read,
 *     jobs:read, payments:read. A key missing a scope returns 403 (not
 *     401) on exactly the endpoints needing it.
 *
 * WHAT URABLE CANNOT GIVE US (still true, unchanged from before):
 *   - Marketing/ad attribution. Urable has no concept of "which Meta
 *     campaign generated this booking." Real Ad -> Lead -> Booking ->
 *     Revenue attribution has to come from lead_source_id captured when a
 *     lead first enters the CRM — see docs/marketing-attribution.md. A
 *     direct Urable booking with no CRM opportunity has no attribution
 *     path at all with data available today. This adapter does not
 *     attempt to invent a mapping from Urable's generic per-job
 *     `customData` array to a CRM opportunity id — that mapping does not
 *     exist yet (no GoHighLevel <-> Urable linkage has been built), so
 *     every Urable-sourced job syncs with opportunity_id = null until that
 *     linkage is designed and confirmed against a real payload.
 */

const URABLE_API_BASE = "https://app.urable.com/api";
const PAGE_LIMIT = 100; // API max per page.

async function urableGet(path: string) {
  const res = await fetch(`${URABLE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.URABLE_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Urable API error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(`Urable API error: ${json.error ?? "unknown"}`);
  }
  return json;
}

/** Pages through a list endpoint via `startAfter` cursor until a short page ends it. */
async function urableListAll<T = any>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const all: T[] = [];
  let startAfter: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ ...params, limit: String(PAGE_LIMIT) });
    if (startAfter) query.set("startAfter", startAfter);
    const page = await urableGet(`${path}?${query.toString()}`);
    const items: any[] = page?.data ?? [];
    all.push(...items);
    if (items.length < PAGE_LIMIT) break;
    startAfter = items[items.length - 1]?.id;
    if (!startAfter) break;
  }
  return all;
}

/** Unix epoch milliseconds -> ISO string for a timestamptz column, or null. */
function msToIso(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** "accounts/{accountId}/jobs/{jobId}" -> "jobId" (last path segment). */
function lastRefSegment(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const parts = ref.split("/");
  return parts[parts.length - 1] || null;
}

/**
 * Maps Urable's real job status to our `job_status` enum. Urable's values
 * are: quote, scheduled, in progress, completed, archived, canceled (see
 * migration 0021 for 'quote' and 'archived' being added to the enum — the
 * original enum only had scheduled/in_progress/completed/canceled).
 */
function mapJobStatus(urableStatus: string | undefined): string {
  switch (urableStatus) {
    case "in progress":
      return "in_progress";
    case "quote":
    case "scheduled":
    case "completed":
    case "archived":
    case "canceled":
      return urableStatus;
    default:
      return "scheduled";
  }
}

/**
 * Maps Urable's real payment status to our `payment_status` enum.
 * Urable: paid, pending, processing, failed, refunded, partial refund,
 * voided, past due. See migration 0021 for the enum additions
 * (processing, partial_refund, voided, past_due) — 'paid' maps onto the
 * existing 'succeeded' value rather than adding a duplicate.
 */
function mapPaymentStatus(urableStatus: string | undefined): string {
  switch (urableStatus) {
    case "paid":
      return "succeeded";
    case "partial refund":
      return "partial_refund";
    case "past due":
      return "past_due";
    case "pending":
    case "processing":
    case "failed":
    case "refunded":
    case "voided":
      return urableStatus;
    default:
      return "pending";
  }
}

/** First email/phone off a Customer's `emails`/`phoneNumbers` arrays, or the singular fallback fields. */
function firstLabeledValue(customer: any, arrayKey: string, singularKey: string): string | null {
  const arr = customer?.[arrayKey];
  if (Array.isArray(arr) && arr.length > 0 && arr[0]?.value) return arr[0].value;
  return customer?.[singularKey]?.value ?? null;
}

/** Every distinct service name referenced in a job's invoice, joined for the `service_name` text column. */
function serviceNamesFromInvoice(invoice: any): string | null {
  const itemsByRef = invoice?.items ?? {};
  const names = new Set<string>();
  for (const lineItems of Object.values(itemsByRef)) {
    for (const li of (lineItems as any[]) ?? []) {
      const name = li?.service?.name;
      if (name) names.add(name);
    }
  }
  return names.size > 0 ? Array.from(names).join(", ") : null;
}

export const urableAdapter: IntegrationAdapter = {
  platform: "urable",

  isConfigured() {
    return envPresent("URABLE_API_KEY");
  },

  async testConnection() {
    try {
      // Cheapest real read: Users is small (your own team) and not paginated.
      await urableGet("/v1/users");
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  async sync(): Promise<SyncResult> {
    const supabase = createSupabaseServiceRoleClient();
    let synced = 0;
    const errors: string[] = [];

    // ---- Customers first, so jobs/payments can join phone/email by id ----
    const customers = await urableListAll("/v1/customers");
    const customerById = new Map<string, any>();
    for (const c of customers) customerById.set(c.id, c);

    // ---- Jobs: the booking + invoice system of record ----
    const jobs = await urableListAll("/v1/jobs");
    // Local jobs.id (our uuid) and opportunity_id by Urable job id, so the
    // payments pass below can link back without a second DB round trip per row.
    const localJobByExternalId = new Map<string, { id: string; opportunity_id: string | null }>();

    for (const job of jobs) {
      const customerId = lastRefSegment(job.customerRef);
      const customer = customerId ? customerById.get(customerId) : undefined;

      const { data: upserted, error } = await supabase
        .from("jobs")
        .upsert(
          {
            external_id: job.id,
            source_platform: "urable",
            // No verified way to resolve a CRM opportunity id from Urable's
            // generic customData yet — see the file header. Left null.
            opportunity_id: null,
            scheduled_at: msToIso(job.start),
            completed_at: job.status === "completed" ? msToIso(job.completedAt) : null,
            status: mapJobStatus(job.status),
            payment_status: job.paymentStatus ?? null,
            customer_name: job.customerName ?? customer?.name ?? null,
            customer_phone: customer ? firstLabeledValue(customer, "phoneNumbers", "phoneNumber") : null,
            customer_email: customer ? firstLabeledValue(customer, "emails", "email") : null,
            vehicle: job.name ?? null,
            service_name: serviceNamesFromInvoice(job.invoice),
            invoice_total_cents: job.invoice?.total ?? null,
            service_address: job.location?.value?.address?.formattedAddress ?? null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "source_platform,external_id" }
        )
        .select("id, opportunity_id")
        .single();

      if (error) {
        errors.push(`job ${job.id}: ${error.message}`);
        continue;
      }
      synced++;
      if (upserted) localJobByExternalId.set(job.id, upserted);
    }

    // ---- Payments: the actual cash/card/check collected against those jobs ----
    // Only jobIds are read here (not orderIds) — this business doesn't sell
    // retail products/gift cards through Urable's Orders, only detailing
    // jobs, so Orders sync is intentionally out of scope for now.
    const payments = await urableListAll("/v1/payments");

    for (const payment of payments) {
      // A payment can apply to more than one job (split across jobOrderRefs).
      // We link to the first job only — this business overwhelmingly records
      // one payment per job, and modeling a payment split across multiple
      // jobs would need a join table this schema doesn't have yet. Flagged
      // here rather than silently guessed away.
      const firstJobRef = (payment.jobOrderRefs ?? []).find((ref: string) => ref.includes("/jobs/"));
      const jobExternalId = lastRefSegment(firstJobRef);
      const localJob = jobExternalId ? localJobByExternalId.get(jobExternalId) : undefined;

      if ((payment.jobOrderRefs ?? []).length > 1) {
        errors.push(`payment ${payment.id} applies to ${payment.jobOrderRefs.length} jobs; only the first was linked`);
      }

      const { error } = await supabase.from("payments").upsert(
        {
          external_id: payment.id,
          source_platform: "urable",
          job_id: localJob?.id ?? null,
          opportunity_id: localJob?.opportunity_id ?? null,
          amount_cents: payment.total ?? 0,
          // Urable doesn't distinguish deposit/balance/full_payment (a job
          // can receive any number of partial payments) — only flag refunds,
          // which we can tell from status; otherwise leave the historical
          // deposit/balance/full_payment distinction unset rather than guess.
          type: payment.status === "refunded" || payment.status === "partial refund" ? "refund" : null,
          status: mapPaymentStatus(payment.status),
          payment_method: payment.paymentMethod ?? null,
          payment_method_details: payment.paymentMethodDetails ?? null,
          processed_at: msToIso(payment.paidAt),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source_platform,external_id" }
      );

      if (error) {
        errors.push(`payment ${payment.id}: ${error.message}`);
        continue;
      }
      synced++;
    }

    return {
      status: errors.length === 0 ? "success" : synced > 0 ? "partial" : "failed",
      recordsSynced: synced,
      errorMessage: errors.length > 0 ? errors.slice(0, 10).join("; ") + (errors.length > 10 ? ` (+${errors.length - 10} more)` : "") : undefined,
    };
  },
};
