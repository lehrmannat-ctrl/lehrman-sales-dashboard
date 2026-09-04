# Integration Setup Guide

For every integration below: set the env vars in `.env.local` (see
`.env.example`), redeploy, then use the **Resync now** button on
`/settings/integrations` and confirm `status` flips to `connected` with no
`last_error`. Never assume it worked — check the sync log table on that
page.

## Stripe (payments — highest confidence adapter)

1. In the Stripe Dashboard, create a restricted API key with read access to
   PaymentIntents/Charges. Set `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint pointing to
   `https://<your-domain>/api/webhooks/stripe`, subscribed to
   `payment_intent.succeeded`, `payment_intent.payment_failed`, and
   `charge.refunded`. Copy the signing secret into
   `STRIPE_WEBHOOK_SECRET`.
3. **Required for reconciliation to work at all**: every Stripe
   PaymentIntent/Checkout Session must include
   `metadata: { opportunity_id, payment_type }` (payment_type = `deposit`,
   `balance`, or omitted for a single full payment). Without this, a
   payment cannot be linked back to a deal — see
   `src/lib/integrations/stripe.ts`'s TODO.
4. Test: make a $1 test payment with the right metadata, confirm it shows
   up in `/revenue` as cash collected within a few seconds (webhook) and
   survives a manual resync (backfill path).

## GoHighLevel ("Surge CRM")

1. Confirm which API generation this account uses (legacy v1 API key vs.
   v2 OAuth + location token) — this determines whether
   `src/lib/integrations/gohighlevel.ts`'s base URL/auth header is correct
   as written. **This was not verified against a live account.**
2. Set `GHL_API_KEY` and `GHL_LOCATION_ID`.
3. Confirm the pipeline's actual stage names in GHL and update
   `mapGhlStageToPipelineStage()` to match exactly (case-sensitive stage
   names are a common source of silent mismatches).
4. Set up an outbound webhook/workflow in GHL to POST to
   `https://<your-domain>/api/webhooks/gohighlevel` with a shared secret
   header (`x-webhook-secret` = `GHL_WEBHOOK_SECRET`). **Log the first real
   payload GHL sends and compare it against the shape assumed in that
   route** before trusting it.

## Call summaries (AI) — reads calls straight out of GoHighLevel

Confirmed 2026-08-29: calls happen directly inside GoHighLevel on the
business's own number (616-427-1814) — there is no separate phone system, so
this reads recordings from the same GoHighLevel account/credentials already
set up above, not Quo. See `src/lib/integrations/call-summaries.ts` for the
full picture, including every `TODO(verify)`.

1. Get an OpenAI API key: go to platform.openai.com, sign up (this is
   separate from a regular ChatGPT subscription — it's a developer/API
   account), add a payment method under Billing, then create a key under
   API keys. Set `OPENAI_API_KEY` in `.env.local`.
2. Restart the app so it picks up the new env var, then go to
   Settings → Integrations. The "Call summaries (AI)" card should now show
   its "Sync call summaries" button enabled instead of greyed out.
3. Click it. This is genuinely unverified against GoHighLevel's live call
   data (this project's dev environment has no general internet access to
   test with) — the conversations/messages endpoints and the recording
   download path are all written from GoHighLevel's public docs. **Report
   back exactly what happens**, including the full text of any error shown
   under the button — that's how the GoHighLevel stage-mapping bug got
   found and fixed earlier, and this needs the same real-account feedback
   loop.
4. Cost: roughly $0.01 per call (OpenAI Whisper transcription + a cheap
   chat-completion call to pull out the summary). This does not run
   automatically on a schedule — it's a manual button, on purpose, since it
   spends real money each time.

## Quo (phone tracking)

`src/lib/integrations/quo.ts` is a best-guess placeholder — Quo's API
surface could not be confirmed without a live account. Before enabling:
1. Get the actual API base URL, auth scheme, and calls-list endpoint from
   Quo's account settings/developer docs.
2. Decide how a call will be linked to a lead. This scaffold does NOT
   implement phone-number matching (see `docs/known-limitations.md`) —
   that has to be built once you know whether Quo can return the
   associated CRM contact directly (much more reliable than phone matching).

## Urable (scheduling)

Also unverified against a live account. Before enabling:
1. Confirm the jobs/appointments API shape (see `src/lib/integrations/urable.ts`
   for every field-name guess that needs checking against a real payload —
   customer name/phone/email, vehicle, service name, price, address).
2. Decide how a job record carries the opportunity id it belongs to —
   this scaffold assumes a custom field on the job holds it, which likely
   needs to be configured in Urable and populated when the job is booked
   (ideally pushed there automatically from GoHighLevel at booking time).
   **This is now optional, not required**: a job with no opportunity id
   still syncs as a direct Urable booking (migration 0018), using Urable's
   own customer/service/price fields instead of the CRM's. Its revenue
   shows as "quoted in Urable," not "collected" (that still only comes from
   Stripe via an opportunity link).
3. Urable has no concept of marketing attribution (which ad led to this
   booking) — see `docs/marketing-attribution.md`. Don't expect it to ever
   report that; it isn't the right system for it.

## Meta Ads

1. Create a Meta Marketing API access token with `ads_read` permission for
   the ad account. Set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`.
2. Confirm the current Graph API version (`GRAPH_API_VERSION` in
   `src/lib/integrations/meta.ts`) is still supported — Meta deprecates
   old versions on a schedule.
3. `leads_attributed` (on the campaign-level `ad_spend` table) is
   intentionally left unset by this adapter — Meta's own lead-attribution
   can disagree with the CRM's. Backfill it from GoHighLevel's
   `lead_source_id` counts instead so there's one honest number, not two
   disagreeing ones.
4. As of this version, the adapter also syncs ad-set/ad-level detail into
   `ad_performance_daily` (impressions, reach, frequency, link clicks,
   CPM/CTR/CPC computed from those, and Meta's own lead count per ad) — this
   is what the daily/weekly/monthly marketing-audit automations read.
   `meta_leads` on that table is Meta's own count, kept separate from the
   CRM's — see `docs/marketing-attribution.md` for why the two aren't
   blended into one number.

## QuickBooks Online (the simple P&L section)

This is a DIFFERENT thing from the "Intuit QuickBooks" connector available
inside a Claude conversation — that connector is useful for asking Claude
ad-hoc financial questions in chat, but it cannot be used by this app's own
always-on Vercel-hosted sync, which needs its own OAuth app credentials.

1. Go to [developer.intuit.com](https://developer.intuit.com), sign in with
   the QuickBooks Online login, and create an app (Development → Create an
   app → QuickBooks Online and Payments).
2. Under that app's "Keys & OAuth", copy the **Client ID** and **Client
   Secret** (use the Production keys once ready to go live — Development
   keys only work against a sandbox company). Set `QUICKBOOKS_CLIENT_ID` and
   `QUICKBOOKS_CLIENT_SECRET`.
3. Get a refresh token and the company's realm ID: the easiest path is
   Intuit's [OAuth 2.0 Playground](https://developer.intuit.com/app/developer/playground) —
   connect it to the real company, authorize, and it hands back both the
   `realmId` (set as `QUICKBOOKS_REALM_ID`) and a `refresh_token` (set as
   `QUICKBOOKS_REFRESH_TOKEN`).
4. Leave `QUICKBOOKS_ENVIRONMENT` unset (defaults to production) once
   pointed at the real company; set it to `sandbox` only while testing
   against Intuit's sandbox company.
5. **Known limitation to watch for**: QuickBooks refresh tokens expire after
   ~100 days of the integration going unused, and rotate on every use. This
   adapter does not yet persist the rotated token anywhere (see the
   TODO in `src/lib/integrations/quickbooks.ts`) — if syncing ever starts
   failing with an auth error after a long quiet period, generate a fresh
   refresh token via the OAuth Playground and update the env var.
6. **Required for the numbers to land in the right buckets**: the adapter
   sorts QuickBooks Online's chart-of-accounts line items into Supplies /
   Labor / Marketing / Rent / Other by keyword-matching the account name
   (see `bucketExpenseLine()`). If an expense account is named something
   the keyword list won't catch (check the function before assuming), it
   falls into "Other" — either rename the account in QuickBooks to include
   an obvious keyword, or extend the keyword list in that function.
7. Test: Resync now on `/settings/integrations`, then check the P&L section
   on the Owner Dashboard shows non-zero numbers matching what QuickBooks
   itself reports for the current month.

## Running the scheduled sync

`POST /api/cron/sync` with header `x-cron-secret: <CRON_SECRET>` runs every
adapter's backfill sync and then refreshes alerts. Point any external
scheduler (a host's cron feature, GitHub Actions on a schedule, etc.) at
this endpoint every 15–60 minutes — see `docs/deployment-guide.md`.
