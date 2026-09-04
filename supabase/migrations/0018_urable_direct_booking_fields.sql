-- Urable can be the FIRST place a booking exists (a customer who books
-- directly through Urable's own scheduling, never passing through the
-- GoHighLevel CRM pipeline as a "lead"). The old schema required every job
-- to have an opportunity_id, which meant those bookings were silently
-- dropped by the sync (see the old urable.ts `if (!opportunityId) continue`).
-- This migration makes the link optional and adds the fields Urable itself
-- can supply directly, so a job is never lost just because it has no CRM
-- opportunity to attach to.

alter table jobs alter column opportunity_id drop not null;

alter table jobs
  add column customer_name text,
  add column customer_phone text,
  add column customer_email text,
  add column vehicle text,
  add column service_name text,
  -- Urable's own quoted/booked price -- NOT the revenue system of record.
  -- Actual cash collected still comes from `payments` (Stripe). This column
  -- exists so a directly-booked job (no opportunity_id, so no `payments`
  -- linkage at all) still shows *some* revenue signal on the owner
  -- dashboard, clearly labeled as "quoted in Urable" rather than "collected".
  add column quoted_amount_cents integer,
  add column service_address text;

comment on column jobs.opportunity_id is 'Nullable: a job with no CRM opportunity is a direct Urable booking. Revenue for THOSE jobs is quoted_amount_cents (Urable''s own quote), not payments -- there is no Stripe/payments linkage without an opportunity_id.';
comment on column jobs.quoted_amount_cents is 'Urable''s own quoted/booked price at time of scheduling. Informational only -- payments.amount_cents (via opportunity_id) remains the source of truth for cash actually collected wherever that link exists.';
