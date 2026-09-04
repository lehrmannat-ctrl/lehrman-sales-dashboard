# Lehrman Mobile Detail — Sales Command Center

A sales command center for Lehrman Mobile Detail LLC (Grand Rapids),
scaled to fit a solo owner-operator business — not the larger, more
complex competitor this spec was originally adapted from.

## Start here

1. `docs/architecture.md` — how the system is put together and why.
2. `docs/known-limitations.md` — what's real, what's a placeholder, what's
   unverified. Read this before assuming anything works end-to-end.
3. `docs/deployment-guide.md` — how to actually stand this up.
4. `docs/remaining-human-actions.md` — the checklist only a human can
   finish.

## What this is, honestly

Every SQL migration, the follow-up cadence engine, the date-range math, the
KPI/forecast formulas, and the Stripe webhook signature verification were
executed and validated directly during development (see
`docs/testing-checklist.md`) — not just written and assumed correct. The
environment this was built in had no network access to npm or a live
Supabase project, so the Next.js application itself has never been through
`npm install` / `next build` / `next dev`. That is the first thing to do
with this codebase, and it counts as part of finishing it, not as
optional polish.

## Structure

```
supabase/migrations/   -- 7 SQL migrations: schema, RLS, triggers, views,
                           alerts function, lead-funnel view, integration helper
supabase/seed.sql       -- generated demo data (scripts/generate_seed.py) — dev/staging only
src/lib/                -- KPI math, permissions, date ranges, follow-up
                           engine, data-access queries, integration adapters
src/app/                -- Next.js App Router pages, one per docs/page-map.md
docs/                   -- everything listed above, plus the KPI dictionary,
                           role/permission matrix, admin & user guides,
                           production-readiness scorecard
```

## Quick start (once you have Node + a Supabase project)

```
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

See `docs/deployment-guide.md` for the full path from here to a deployed,
integrated, production system.
