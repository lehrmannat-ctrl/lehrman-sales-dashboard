# Architecture — Lehrman Mobile Detail Sales Command Center

## 1. System overview

A single Next.js (App Router, TypeScript) application backed by Supabase
(Postgres + Auth). Server Components read directly from Postgres views and
tables through the Supabase JS client, scoped by Row Level Security. Five
external systems feed data in through a common adapter interface:

```
GoHighLevel ──┐
Quo ──────────┤
Stripe ───────┼──▶ adapters (src/lib/integrations/*) ──▶ Postgres ──▶ Next.js pages
Urable ───────┤        ▲                                     │
Meta Ads ─────┘        │                                     ▼
                 webhooks (real-time)                  Row Level Security
                 + scheduled sync (backfill)            scopes every read
```

Two independent security layers exist on purpose and are meant to agree,
not to be "the same check written twice":

1. **Application-layer permission checks** (`src/lib/permissions.ts`,
   `src/middleware.ts`) — control navigation and UX.
2. **Postgres Row Level Security** (`supabase/migrations/0002_rls.sql`) —
   controls what a query can physically return, no matter how it's issued
   (a bug in #1 cannot leak data because of #2).

## 2. Data ownership rules (single source of truth per data type)

| Data type | System of record | Table(s) |
|---|---|---|
| Leads, opportunities, stages, sales activity notes | GoHighLevel | `leads`, `opportunities`, `stage_history` |
| Calls, recordings, call duration | Quo | `activities` (type = dial/connected_call) |
| Actual cash collected | Stripe | `payments` |
| Booked/completed jobs | Urable | `appointments`, `jobs` |
| Ad spend | Meta Ads (Google Ads when added) | `ad_spend` |
| Finalized accounting | QuickBooks (not yet connected — see known-limitations.md) | n/a |

Every synced record carries `external_id` + `source_platform` +
`last_synced_at` so re-running a sync is idempotent (upsert on
`(source_platform, external_id)`), which is how duplicate leads/payments/
jobs are prevented at the database level, not just by hoping the sync logic
never double-fires.

## 3. The six revenue/cash numbers that must never be merged

1. **Revenue sold** — value of opportunities the day they crossed into the
   `sold` stage (`v_revenue_sold_daily`).
2. **Cash collected** — net of successful Stripe payments minus refunds,
   by the day Stripe actually processed them (`v_cash_collected_daily`).
3. **Deposits collected** — the subset of #2 that was a `deposit` payment.
4. **Remaining accounts receivable** — #1 minus #2 for opportunities not
   yet fully paid (computed live, not stored, so it's always current).
5. **Completed-job revenue** — value of opportunities whose `jobs` row is
   `completed` (`v_completed_job_revenue_daily`) — only counts once the
   detailing work is actually done, regardless of payment status.
6. **Refunded/canceled revenue** — `refunded_cents` in
   `v_cash_collected_daily`, plus `lost_reason` on opportunities.

Full formulas: `docs/kpi-dictionary.md`.

## 4. Follow-up cadence engine

`src/lib/followup-engine.ts` is a pure, dependency-free module (no
database calls) implementing the owner's exact cadence rules:

- Initial contact: 2 calls/day for 7 days, then 1 call every other day
  through day 14 (18 tasks total), then the engine stops automatically.
- Recall cadence once contacted: hot = 3/7/10/14 days, warm = 7/14/21 days,
  cold = 15/30/60 days after first contact (or a customer-given timeframe).
- Every generated timestamp is pushed off Sunday to Monday — the shop is
  never open Sundays (`skipSunday()`), and the database additionally
  enforces this with `CHECK` constraints on `appointments` and
  `follow_up_tasks` as a backstop.

This logic was executed directly (not just read) during development — see
`docs/testing-checklist.md` for how to re-run that validation.

## 5. Alerting

`generate_alerts()` (`supabase/migrations/0005_alerts_function.sql`) is an
idempotent Postgres function that scans real data and opens/resolves alert
rows. It's meant to run on a schedule (see `docs/deployment-guide.md`). It
intentionally covers a focused subset of the spec's full alert list first
(see `docs/kpi-dictionary.md` "Alert catalog") — each additional alert type
follows the exact same detect-condition → upsert-alert shape, so extending
it is mechanical, not architectural.

## 6. Page map

See `docs/page-map.md`.

## 7. Risks and assumptions

- **No live integration credentials were available while building this.**
  Stripe's adapter is written against a stable, well-known API and is the
  most likely to work close to as-written. GoHighLevel, Quo, Urable, and
  Meta adapters are written from public documentation patterns and are
  explicitly marked with `TODO(verify)` at every point that needs
  confirming against the live account before go-live. Do not flip any of
  them to "connected" without running `docs/testing-checklist.md` against
  the real account first.
- **The follow-up cadence engine lives in application code, not a database
  trigger**, specifically so there's exactly one implementation to keep
  correct (see `supabase/migrations/0003_functions_triggers.sql`'s
  comment). A CRM webhook handler or a manual UI action is what should call
  it — this scaffold has the engine itself validated, but the exact call
  site (which webhook event fires it, for example) needs to be wired once
  GoHighLevel's webhook payloads are confirmed.
- **Quo call-to-lead linking is not implemented.** Matching a call to a
  lead requires phone-number matching that wasn't safe to guess at — see
  `docs/known-limitations.md`.
- **Seed data is a simplification, not a full historical backfill.**
  Opportunities are seeded directly at a terminal demo stage rather than
  simulated through every intermediate transition — see the comment at the
  top of `supabase/seed.sql`.
- **This sandbox had no network access to npm or a live Supabase
  project**, so the app was never run through `next build`/`next dev`.
  Every SQL migration, the follow-up cadence engine, the date-range logic,
  and the KPI math were instead executed directly against a local
  PostgreSQL 16 instance and with Node's TypeScript stripping — see
  `docs/testing-checklist.md` for exactly what was and wasn't run, and
  what to verify once real `npm install` is possible.
