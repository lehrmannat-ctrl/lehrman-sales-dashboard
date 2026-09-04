# Deployment Guide

## 1. Create the Supabase project

1. Create a project at supabase.com (or self-host).
2. In the SQL editor (or via `supabase db push` / the CLI), run the
   migrations in `supabase/migrations/` **in numeric order**, 0001 through
   0007. Do NOT run `scripts/local_test_auth_stub.sql` — that file only
   exists to test migrations locally without a real Supabase project, and
   would conflict with Supabase's real `auth` schema.
3. Optionally load `supabase/seed.sql` into a staging project to see the
   dashboard populated with realistic demo data. Never load it into
   production.
4. Copy the project URL and anon key into `.env.local` as
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the
   service role key into `SUPABASE_SERVICE_ROLE_KEY` — server-only, never
   exposed to the browser.

## 2. Configure Supabase Auth

1. Enable email/password (or magic link) auth in the Supabase dashboard.
2. Decide how `profiles` rows get created: either a Postgres trigger on
   `auth.users` insert (recommended — add a migration for it), or manual
   creation by the owner after inviting each teammate. Either way, every
   `auth.users` row needs a matching `profiles` row with the right `role`
   or that person can log in but see nothing (RLS default-denies).
3. Create the owner's own login first and set `role = 'owner'` directly in
   the `profiles` table (there's no self-service "become owner" flow, by
   design).

## 3. Local development

```
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

This was never run in the sandbox that built this codebase (no npm
registry access) — running it for the first time IS part of testing this
delivery, not an optional step. Fix whatever TypeScript/build errors
surface; see `docs/known-limitations.md` for where they're most likely.

## 4. Hosting

Any Next.js-compatible host works (Vercel is the path of least friction
given the App Router + Server Actions used throughout). Set every variable
from `.env.example` in the host's environment variable settings —
`SUPABASE_SERVICE_ROLE_KEY`, all five integrations' keys, and
`CRON_SECRET`.

## 5. Scheduled jobs

Two things need to run on a schedule:

1. **Integration sync + alert refresh**: `POST /api/cron/sync` with header
   `x-cron-secret: <CRON_SECRET>`, every 15–60 minutes. On Vercel, use
   Vercel Cron (a `vercel.json` crons entry); elsewhere, any scheduler that
   can make an authenticated HTTPS POST (GitHub Actions on a schedule,
   a host's own cron, etc.) works.
2. Real-time updates come from the Stripe and GoHighLevel webhooks
   (`/api/webhooks/stripe`, `/api/webhooks/gohighlevel`) — configure these
   directly in each provider's dashboard per
   `docs/integration-setup-guide.md`.

## 6. Backup strategy

Supabase takes automatic daily backups on paid plans — confirm the plan
tier includes this and note the retention window. For extra safety, a
simple `pg_dump` on the same schedule as the sync cron, stored somewhere
outside Supabase, costs little and protects against an account-level
incident. This has not been set up as part of this delivery — see
`docs/remaining-human-actions.md`.

## 7. Rollback

Migrations are numbered and additive; a bad migration should be fixed with
a new migration that corrects it (`0008_fix_x.sql`), not by editing an
already-applied file. Keep this discipline once the project has real data.
