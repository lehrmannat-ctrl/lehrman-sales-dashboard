-- =============================================================================
-- Migration 0008: Security hardening (response to Supabase security advisor)
--
-- The advisor scan run right after 0001-0007 were applied to the real
-- project flagged three real issues. This migration fixes all three. Nothing
-- here changes what any view/function computes — only who it computes it as.
--
-- 1) SECURITY DEFINER views (13 of them, all from 0004 + 0007).
--    A plain `create view` in Postgres runs with the PRIVILEGES OF THE VIEW'S
--    OWNER, not the querying user - which means it can silently ignore Row
--    Level Security for whoever queries it. Since src/lib/queries.ts has a
--    sales_associate's own browser session query these views directly, this
--    was a real gap: a sales_associate could potentially see company-wide
--    numbers through a view even though the underlying tables' RLS policies
--    say they should only see their own. `security_invoker = true` (Postgres
--    15+) makes each view run as the QUERYING user instead, so the same RLS
--    policies that already protect `leads`/`opportunities`/`payments`/etc.
--    now also apply when those tables are read through a view.
--
-- 2) Functions with a mutable search_path. Without `set search_path`, a
--    function's unqualified table references resolve using whatever
--    search_path is active when it's called, which is a known privilege-
--    escalation vector for SECURITY DEFINER functions in particular. Pinning
--    it to `public` closes that off; it does not change behavior for this
--    app, since everything already lives in the `public` schema.
--
-- 3) Public RPC exposure. `auth_role()` and `is_owner()` are called FROM
--    inside RLS policies (which always run with the definer's privileges
--    regardless of grants), so `authenticated` still needs EXECUTE - but
--    `anon` never legitimately calls them (this app requires login for
--    everything), so anon's grant is revoked. `increment_integration_records_
--    synced()` is only ever called from the server-side sync job using the
--    service_role key (see src/lib/integrations/registry.ts) - it should
--    never be callable directly by a logged-in browser session, so its
--    public/anon/authenticated grants are revoked entirely.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Views: make them respect the querying user's RLS
-- ---------------------------------------------------------------------------
alter view v_stage_durations set (security_invoker = true);
alter view v_avg_time_in_stage set (security_invoker = true);
alter view v_opportunity_cash set (security_invoker = true);
alter view v_funnel_summary set (security_invoker = true);
alter view v_revenue_sold_daily set (security_invoker = true);
alter view v_cash_collected_daily set (security_invoker = true);
alter view v_completed_job_revenue_daily set (security_invoker = true);
alter view v_activity_daily set (security_invoker = true);
alter view v_leads_daily_by_source set (security_invoker = true);
alter view v_opportunity_daily_by_source set (security_invoker = true);
alter view v_appointments_daily set (security_invoker = true);
alter view v_lead_funnel_summary set (security_invoker = true);
alter view v_stage_ever_reached set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 2) Functions: pin search_path
-- ---------------------------------------------------------------------------
alter function set_updated_at() set search_path = public;
alter function next_non_sunday(timestamptz) set search_path = public;
alter function log_lead_stage_change() set search_path = public;
alter function log_opportunity_stage_change() set search_path = public;
alter function generate_alerts() set search_path = public;
-- auth_role() and is_owner() already had `set search_path = public` from
-- 0002 - the advisor did not flag them for this issue, only for (3) below.

-- ---------------------------------------------------------------------------
-- 3) Grants: narrow public RPC exposure
-- ---------------------------------------------------------------------------
revoke execute on function auth_role() from anon, public;
revoke execute on function is_owner() from anon, public;
grant execute on function auth_role() to authenticated;
grant execute on function is_owner() to authenticated;

revoke execute on function increment_integration_records_synced(uuid, integer) from anon, authenticated, public;
grant execute on function increment_integration_records_synced(uuid, integer) to service_role;
