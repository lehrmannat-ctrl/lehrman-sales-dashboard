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
1. Confirm the jobs/appointments API shape.
2. Decide how a job record carries the opportunity id it belongs to —
   this scaffold assumes a custom field on the job holds it, which likely
   needs to be configured in Urable and populated when the job is booked
   (ideally pushed there automatically from GoHighLevel at booking time).

## Meta Ads

1. Create a Meta Marketing API access token with `ads_read` permission for
   the ad account. Set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`.
2. Confirm the current Graph API version (`GRAPH_API_VERSION` in
   `src/lib/integrations/meta.ts`) is still supported — Meta deprecates
   old versions on a schedule.
3. `leads_attributed` is intentionally left unset by this adapter — Meta's
   own lead-attribution can disagree with the CRM's. Backfill it from
   GoHighLevel's `lead_source_id` counts instead so there's one honest
   number, not two disagreeing ones.

## Running the scheduled sync

`POST /api/cron/sync` with header `x-cron-secret: <CRON_SECRET>` runs every
adapter's backfill sync and then refreshes alerts. Point any external
scheduler (a host's cron feature, GitHub Actions on a schedule, etc.) at
this endpoint every 15–60 minutes — see `docs/deployment-guide.md`.
