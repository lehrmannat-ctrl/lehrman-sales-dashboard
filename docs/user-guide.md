# User Guide (Sales Associate)

## What you'll see

When you log in, you'll land on **My Day** (`/daily`) — your own leads that
need contacting, appointments today, and anything overdue. You'll also
have **My Pipeline** (`/pipeline`) and **My Scorecard** (`/scorecards`),
both scoped to your own assigned leads and deals only — you won't see
other people's numbers, company-wide revenue, or ad spend, and that's by
design, not a bug.

## Working a lead

- New leads needing a first call appear under "New leads not yet
  contacted." Tap **Call** or **Text** to reach out immediately — these
  buttons dial or text directly from your phone.
- Once you've made contact, update the lead's temperature (hot/warm/cold)
  in the CRM as usual — the dashboard's automatic follow-up schedule uses
  that to decide how often to remind you to call back (see below).

## Follow-up cadence (automatic — you don't have to remember this)

- A lead that hasn't answered yet gets a call task twice a day for the
  first week, then every other day for another week. If there's still no
  answer after two weeks, the system stops generating new tasks — at that
  point it's a judgment call whether to keep trying or mark the lead lost.
- Once you reach someone: hot leads get a callback reminder at 3, 7, 10,
  and 14 days; warm leads at 7, 14, and 21 days; cold leads at 15, 30, and
  60 days. If the customer gives you a specific timeframe ("call me back
  in a month"), that overrides the default schedule.
- You will never get a task on a Sunday — the shop is closed, and the
  schedule shifts anything that would land on a Sunday to the next Monday.

## Moving a deal forward

On **My Pipeline**, change a deal's stage directly from the dropdown on
its card. This is a real update, not a preview — it's what the owner and
(once connected) the CRM will also see.

## Your scorecard

Ranked by a weighted score that includes your activity (dials, texts),
conversion rates, cash collected, and follow-up completion — not revenue
alone. See exactly how it's calculated in `docs/kpi-dictionary.md` if
you're curious, or ask the owner, who can adjust the weights.
