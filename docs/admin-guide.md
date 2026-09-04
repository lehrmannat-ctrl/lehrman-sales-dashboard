# Admin Guide (Owner)

## Setting targets

Go to **Goals & Targets** (`/settings/goals`). Every target — monthly
revenue, monthly/weekly cash, daily dials, appointments, show/close rate,
average ticket, speed to lead — is a plain number you can change any time;
nothing requires a developer or a code change. Each save adds a new
effective-dated goal row rather than overwriting history, so past
performance is always judged against the target that was active at the
time.

## Adjusting scorecard weights

Same page, lower section. The seven weights must add up to 1.0 (100%) —
both the form and the database will refuse a save that doesn't. Increase a
weight to make that behavior matter more for ranking; the leaderboard on
`/scorecards` recalculates immediately.

## Managing integrations

`/settings/integrations` shows exactly what's connected, when it last
succeeded or failed, and lets you trigger a manual resync. If a status
says "Not Connected," check that the corresponding environment variables
are set (see `.env.example` and `docs/integration-setup-guide.md`) — this
page never shows "connected" unless the credentials are actually present
and a sync has actually succeeded.

## Adding a teammate (sales associate)

1. Have them sign up (or create their login yourself) through Supabase
   Auth.
2. In the `profiles` table, set their `role` to `sales_associate` and
   `active` to `true`.
3. Assign leads/opportunities to them (`assigned_to` / `salesperson_id`).
   They'll immediately see only their own pipeline, scorecard, and daily
   command center — this is enforced by the database itself, not just by
   what the app chooses to show.

## Resolving alerts

`/alerts` lists every open alert with a recommended action. "Mark
resolved" clears it from the list; if the underlying condition recurs
(e.g. another lead goes uncontacted past 5 minutes), a fresh alert opens
automatically the next time `generate_alerts()` runs.

## Moving a deal through the pipeline

`/pipeline` — change any card's stage directly from its dropdown, in
either the Kanban or table view. This writes straight to the database,
which is also what a real GoHighLevel sync will eventually update
automatically once that integration is live.
