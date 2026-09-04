# Known Limitations

Being direct about these is more useful than a demo that hides them.

## Security advisor: 2 residual warnings, judged acceptable

After migration 0008 fixed the 13 SECURITY DEFINER views and 5
mutable-search-path functions the advisor originally flagged, a re-scan
still shows 2 WARNs: `auth_role()` and `is_owner()` are callable directly
by any logged-in user via Supabase's auto-generated REST RPC endpoints.
This can't be revoked without breaking the app, because every RLS policy
in `0002_rls.sql` calls one of these two functions to check the caller's
role, and RLS policies run with the caller's own grants. The risk this
would normally flag — a function quietly acting with elevated privilege
on data the caller shouldn't see — doesn't apply here: both functions only
ever look up `auth.uid()`'s own row and report back that same user's own
role. There's nothing to escalate. Left as-is deliberately, not an
oversight.

## Environment constraints this was built under

- **No network access to npm or a live Supabase project.** Every file was
  hand-written and validated as far as possible without those (see
  `docs/testing-checklist.md`): all 7 SQL migrations and the seed data ran
  successfully against a real local PostgreSQL 16 instance; the follow-up
  cadence engine, date-range logic, KPI math, and Stripe webhook signature
  verification were executed directly with Node. The Next.js app itself
  has never been through `npm install`, `next build`, or `next dev` — that
  has to be the very first thing done with this codebase, and it may
  surface TypeScript or dependency issues that reading the code did not.
- No live GoHighLevel, Quo, Stripe, Urable, or Meta Ads account was
  available, so none of the five integrations have been tested against
  real data — every adapter is written to fail honestly (`not_connected`)
  until real credentials are supplied and tested.

## Functional gaps

- **Quo call-to-lead linking is not implemented.** A synced call has no
  automatic link to a lead/opportunity — matching by phone number was
  judged too likely to produce wrong links without being able to test it
  against real data. This needs a deliberate design pass once Quo's actual
  API is confirmed (ideally Quo itself can return the linked CRM contact).
- **GoHighLevel opportunity/stage sync is a partial implementation** — the
  contacts (leads) sync is written; syncing opportunities and mapping GHL
  pipeline stage IDs to this app's `pipeline_stage` enum needs the actual
  GHL pipeline configuration to complete (see the TODO in
  `src/lib/integrations/gohighlevel.ts`).
- **Urable job linking assumes a custom field carries the opportunity id**
  — this needs to actually be configured in Urable and populated (likely
  by having GoHighLevel push it at booking time), which wasn't possible to
  verify without account access.
- **CRM Data Accuracy** (5% of the scorecard weight) is currently a fixed
  placeholder (100) rather than a real measurement of missing attribution,
  stale leads, etc. — the other six weighted inputs are real.
- **8 of the spec's ~16 alert types are implemented**; the rest follow the
  identical pattern in `generate_alerts()` and are listed as not-yet-built
  in `docs/kpi-dictionary.md`'s alert catalog.
- **No automated daily manager summary** (e.g. an email/text digest) —
  Phase 4 item, not built.
- **QuickBooks is not integrated** — the spec mentions it as owning
  "finalized financial reporting" but did not list required fields in
  enough detail to build against without the account; `ad_spend` reporting
  and Stripe's own payment ledger currently stand in for finance reporting.
- **KPI/record drill-down ("click into underlying records") is
  implemented as navigation to the relevant page** (e.g. clicking Revenue
  Sold goes to `/revenue`), not a per-KPI modal showing the exact filtered
  record list. A true drill-down view (e.g. exactly which leads make up
  "New Leads" this week) is a reasonable next iteration.
- **Seed data is a simplification**: opportunities are seeded directly at
  a terminal demo stage rather than simulated through every real
  intermediate transition (see the header comment in
  `supabase/seed.sql`), so stage-by-stage timing in the demo data is
  illustrative, not a precise historical backfill.
- **Mobile/tablet layout is coded with Tailwind's responsive utilities
  throughout but has not been visually verified in an actual browser** —
  see `docs/testing-checklist.md`.

## Things that were deliberately NOT built to avoid pretending

- No fake "connected" integration statuses.
- No hard-coded demo numbers on any live page — every number shown comes
  from an actual database query, even when the database is empty (in
  which case it correctly shows 0 / "No data").
- No drag-and-drop Kanban (a real, wired dropdown-based stage change was
  built instead of a fake-looking drag interaction that doesn't persist).
