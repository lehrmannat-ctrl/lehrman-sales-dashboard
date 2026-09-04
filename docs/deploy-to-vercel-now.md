# Deploying this to Vercel (get off localhost)

Your build is already working locally (`node_modules`, `.next`, and a filled-in
`.env.local` are all sitting in this folder already) — the only thing missing
is a live URL. This is the exact path to get one, using the same code, same
Supabase project (`ikkglppswhpckepxgnlq`), nothing rebuilt from scratch.

**Why this needs to happen from your own terminal, not from Claude:** Claude's
sandboxed tools in this session can't reach github.com's push protocol,
vercel.com, or the npm registry — those are blocked at the network level for
this environment. Your own PowerShell/terminal on this machine has your
normal internet connection, so these commands need to be run there.

## What Claude already fixed in the code

Two real bugs that only show up once you leave localhost, found while
preparing this:

1. **`next.config.mjs`** — Server Actions (most of this app's mutations) were
   hard-locked to accept requests only from `localhost:3000`. Deployed as-is,
   every save/update button would fail with "Invalid Server Actions request."
   Fixed to also allow Vercel's own domain env vars automatically — no
   further edits needed as the URL changes across deploys.
2. **`src/app/api/cron/sync/route.ts`** — required a `POST` with an
   `x-cron-secret` header. Vercel's own Cron scheduler only ever sends `GET`
   requests and can't set custom headers (it sends `Authorization: Bearer
   <CRON_SECRET>` instead). The route now accepts both, so Vercel Cron
   actually works once wired up below.
3. Added `vercel.json` with a cron entry hitting `/api/cron/sync` every 30
   minutes, per `docs/deployment-guide.md`.

## Steps

Open a terminal in this folder (`C:\Users\lehrm\Downloads\lehrman-dashboard`)
and run:

```
npx vercel login
```

This opens your browser to confirm — log in with whatever you want tied to
this deploy (GitHub, email, etc.).

```
npx vercel link
```

Answer the prompts: link to a new project, keep the suggested name (or call
it `lehrman-sales-dashboard`), accept the defaults for the rest.

### Set the environment variables

Fastest way: go to the project on vercel.com → **Settings → Environment
Variables** → there's an "Import .env" style box you can paste multiple
`KEY=VALUE` lines into at once. Open `.env.local` in this folder, copy
everything from `NEXT_PUBLIC_SUPABASE_URL=` down to the end, and paste it in
for the **Production** environment. That carries over everything you've
already filled in (Supabase, GoHighLevel, the OpenAI key) in one shot — the
still-blank ones (Stripe, Urable, Meta) can stay blank until those are
connected, same as now.

### Deploy

```
npx vercel --prod
```

This builds and deploys on Vercel's infrastructure and prints your live
`https://...vercel.app` URL when it finishes. That's the dashboard, online,
for real.

## After the first deploy

- **Cron plan limit:** Vercel's free Hobby plan restricts Cron Jobs to once
  per day. If you're on Hobby, either upgrade to Pro for the every-30-minutes
  schedule in `vercel.json`, or leave the cron as-is for now and use an
  outside scheduler (e.g. a free account on cron-job.org, or a GitHub Actions
  scheduled workflow) to `POST` to `/api/cron/sync` with header
  `x-cron-secret: <the CRON_SECRET value from .env.local>` every 15–60
  minutes instead.
- **Webhooks:** once Stripe and GoHighLevel are actually wired up, point
  their webhook URLs at `https://<your-vercel-domain>/api/webhooks/stripe`
  and `/api/webhooks/gohighlevel` — see `docs/integration-setup-guide.md`.
- **Custom domain:** if you want this at your own domain instead of
  `*.vercel.app`, that's Vercel project Settings → Domains.
