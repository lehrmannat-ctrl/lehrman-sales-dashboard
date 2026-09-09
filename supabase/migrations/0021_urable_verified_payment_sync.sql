-- Urable's real public API was verified against Nathaniel's live account on
-- 2026-09-04 (see the Claude project's business-ops-automation doc for the
-- full story). Two corrections fall out of that verification:
--
-- 1. Nathaniel confirmed every payment his business collects — card (via
--    Urable's own embedded Stripe), cash, and checks — is recorded in
--    Urable itself. There is no standalone Stripe integration; Urable's
--    /v1/payments is now the single source of "cash actually collected".
--    A payment needs to link to the JOB it was collected against, not only
--    to a CRM opportunity — a direct Urable booking with no CRM opportunity
--    (see migration 0018) still needs its payment recorded somewhere.
-- 2. Urable's real job/payment status vocabularies are richer than what
--    this schema originally guessed, and it doesn't distinguish
--    deposit/balance/full_payment the way the old Stripe-metadata design
--    assumed (a job can receive any number of partial payments with no
--    label as to which is "the deposit").

-- ---------------------------------------------------------------------------
-- jobs: real status vocabulary, and rename the quote-only-sounding column
-- now that it holds a real invoice total (paid or not).
-- ---------------------------------------------------------------------------
alter type job_status add value if not exists 'quote';
alter type job_status add value if not exists 'archived';

alter table jobs rename column quoted_amount_cents to invoice_total_cents;

comment on column jobs.invoice_total_cents is 'Urable''s invoice total for this job, in cents — verified real field (invoice.total), whether or not it has been paid. For cash actually collected, join payments on job_id (payments.status = ''succeeded'').';

alter table jobs add column payment_status text;
comment on column jobs.payment_status is 'Urable''s own job-level payment status (pending/unpaid/paid), synced as-is for a quick cross-check against the payments table — not itself the source of truth for collected revenue.';

-- ---------------------------------------------------------------------------
-- payments: link to the job that was actually paid (not just an
-- opportunity, since a direct Urable booking has none), and carry Urable's
-- real payment method instead of assuming Stripe.
-- ---------------------------------------------------------------------------
alter table payments add column job_id uuid references jobs(id) on delete cascade;
create index idx_payments_job on payments(job_id);
comment on column payments.job_id is 'The job this payment was collected against (Urable jobOrderRefs, first ref only — see urable.ts for the rare split-payment-across-jobs caveat). opportunity_id is still populated when the job has one, for existing category-level revenue queries.';

alter table payments alter column type drop not null;
comment on column payments.type is 'Nullable as of migration 0021: Urable does not distinguish deposit/balance/full_payment (a job can take any number of partial payments with no label for which is "the deposit"). Only set to ''refund'' when Urable''s own status says so; null otherwise rather than guessing.';

alter table payments add column payment_method text;
comment on column payments.payment_method is 'Urable''s own paymentMethod, synced as-is: stripe (card, via Urable''s embedded Stripe), cash, check, other, or none.';

alter table payments add column payment_method_details text;
comment on column payments.payment_method_details is 'Urable''s human-readable payment detail, e.g. "visa ****4599". Null for cash/check.';

alter type payment_status add value if not exists 'processing';
alter type payment_status add value if not exists 'partial_refund';
alter type payment_status add value if not exists 'voided';
alter type payment_status add value if not exists 'past_due';
-- Note: Urable's 'paid' status maps onto the existing 'succeeded' value in
-- code (urable.ts's mapPaymentStatus) rather than adding a duplicate here.

alter table payments alter column source_platform drop default;
comment on table payments is 'Money collected. As of migration 0021, source_platform is ''urable'' for essentially everything this business collects (card via Urable''s embedded Stripe, cash, checks) — there is no separate Stripe integration.';
