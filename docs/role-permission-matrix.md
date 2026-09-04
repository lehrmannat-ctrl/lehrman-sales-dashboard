# Role & Permission Matrix

Two roles today (`owner`, `sales_associate` — see `user_role` enum in
`supabase/migrations/0001_schema.sql`), matching this business: Nathaniel
holds both the owner login and, if a login is created for daily field use,
the sales_associate role. A future hire is just a second `profiles` row
with `role = 'sales_associate'` — no code changes needed.

Enforced in two places that are expected to independently agree:
`src/lib/permissions.ts` (navigation/UX) and `supabase/migrations/
0002_rls.sql` (actual data access, Postgres Row Level Security).

| Data / Page | Owner | Sales Associate |
|---|---|---|
| Executive Dashboard, all KPIs | ✅ | ❌ (redirected to Daily / My Day) |
| Company-wide revenue & cash | ✅ | ❌ |
| Ad spend / lead source ROAS | ✅ | ❌ |
| All salespeople's performance | ✅ | ❌ (sees only their own) |
| Their own scorecard | ✅ | ✅ |
| Pipeline — all deals | ✅ | ❌ |
| Pipeline — their own assigned deals | ✅ | ✅ |
| Call recordings | ✅ | ❌ (only calls tied to their own leads) |
| Forecasts | ✅ | ❌ |
| Goals & targets (edit) | ✅ | ❌ |
| Scorecard weights (edit) | ✅ | ❌ |
| Integrations settings | ✅ | ❌ |
| Alerts — all | ✅ | only alerts addressed to them |
| Daily Command Center | ✅ (company-wide) | ✅ (their own leads only, via RLS) |

Row Level Security specifics (`supabase/migrations/0002_rls.sql`):

- `leads.assigned_to = auth.uid()` and `opportunities.salesperson_id =
  auth.uid()` gate a sales_associate's reads/writes on those tables.
- `payments` and `jobs` are visible to a sales_associate only through their
  own opportunities (needed for "cash influenced" on their personal
  scorecard) — never the full company ledger.
- `ad_spend`, `goals`, `scorecard_weights`, `integrations`, `sync_logs`,
  and `audit_log` reads are owner-only, full stop.
- `profiles` — anyone can read/update their own row; only the owner can
  read/edit everyone else's.

If a third role is ever needed (e.g. a dedicated "sales manager" as in the
original larger-business spec this was adapted from), add it to the
`user_role` enum, add its capabilities to `CAPABILITIES_BY_ROLE` in
`src/lib/permissions.ts`, and add matching RLS policies — the pattern is
consistent across every table.

## Sales associate sidebar (simplified 2026-08-29)

Per the owner's request, the sales_associate nav (`PAGES_BY_ROLE.sales_associate`
in `src/lib/permissions.ts`) is deliberately just two links now: **Tasks** and
**Scorecard**. The underlying routes (`/daily`, `/leads`, `/pipeline`) still
exist and are still RLS-scoped correctly for a sales_associate — they're just
not in the sidebar anymore, since the day-to-day job is "work the task list."
The owner's own sidebar is unchanged.

**Tasks** (`/tasks`) is new: it lists pending `follow_up_tasks` rows (soonest
due first), with a "Mark called" / "Skip" button on each. Those rows are
never hand-created — they come entirely from the trigger functions in
`supabase/migrations/0011_followup_cadence_triggers.sql`, which watch the
`leads` table for real stage/temperature transitions:

- A new lead (`stage = 'new_lead'`) gets one "make first contact" task.
- Moving a lead's `stage` to `attempting_contact` ("Initial Contact" in
  GoHighLevel) schedules a morning + afternoon call-back task every day for
  5 days.
- Moving a lead's `stage` *out of* `attempting_contact` cancels
  (`status = 'canceled'`, never deleted) whatever was still pending from
  that 5-day cadence — the job's done either way.
- Moving a lead's `temperature` to hot / warm / cold schedules recall tasks
  at 3/7/10/14, 7/14/21, or 15/30/60 days out respectively, anchored on the
  moment of that exact transition. Changing temperature again cancels
  whatever recall tasks were still pending under the old temperature first,
  so a lead never has two overlapping call-back schedules at once.
- Every due date is pushed off Sunday, matching the business's existing
  "closed Sundays" rule.

Because these are `AFTER INSERT/UPDATE` triggers, they only ever fire on a
real future transition — applying this migration did not retroactively
create tasks for the leads that already existed.
