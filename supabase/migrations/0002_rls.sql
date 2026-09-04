-- =============================================================================
-- Migration 0002: Row Level Security
--
-- Rule of thumb enforced here (matches docs/role-permission-matrix.md):
--   owner            -> full read/write on everything
--   sales_associate  -> read/write only on leads/opportunities/activities/
--                       appointments/follow_up_tasks/alerts assigned to them;
--                       read-only on their own scorecard-relevant aggregates;
--                       NO access to company-wide ad spend, other people's
--                       records, goals, scorecard weights, or integrations.
--
-- These policies are the enforcement layer of last resort. The app ALSO
-- checks permissions server-side before rendering — never rely on RLS alone
-- as the only UI gate, and never rely on the UI alone as the only security
-- gate. Both layers must independently agree.
-- =============================================================================

alter table profiles enable row level security;
alter table leads enable row level security;
alter table opportunities enable row level security;
alter table appointments enable row level security;
alter table activities enable row level security;
alter table follow_up_tasks enable row level security;
alter table payments enable row level security;
alter table jobs enable row level security;
alter table ad_spend enable row level security;
alter table goals enable row level security;
alter table scorecard_weights enable row level security;
alter table alerts enable row level security;
alter table integrations enable row level security;
alter table sync_logs enable row level security;
alter table audit_log enable row level security;
alter table lead_sources enable row level security;
alter table services enable row level security;
alter table stage_history enable row level security;

-- security-definer helper: avoids infinite recursion when policies on
-- `profiles` itself need to know the caller's role.
create or replace function auth_role() returns user_role
language sql security definer stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_owner() returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select role = 'owner' from profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles for select
  using (is_owner() or id = auth.uid());
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_owner_all on profiles for all
  using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------------
-- lookup tables — everyone authenticated can read, only owner writes
-- ---------------------------------------------------------------------------
create policy lead_sources_read on lead_sources for select using (auth.uid() is not null);
create policy lead_sources_owner_write on lead_sources for all using (is_owner()) with check (is_owner());
create policy services_read on services for select using (auth.uid() is not null);
create policy services_owner_write on services for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------------
-- leads: owner sees all; sales_associate sees only assigned
-- ---------------------------------------------------------------------------
create policy leads_owner_all on leads for all using (is_owner()) with check (is_owner());
create policy leads_assoc_select on leads for select using (assigned_to = auth.uid());
create policy leads_assoc_update on leads for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- ---------------------------------------------------------------------------
-- opportunities: same pattern, scoped through salesperson_id
-- ---------------------------------------------------------------------------
create policy opps_owner_all on opportunities for all using (is_owner()) with check (is_owner());
create policy opps_assoc_select on opportunities for select using (salesperson_id = auth.uid());
create policy opps_assoc_update on opportunities for update using (salesperson_id = auth.uid())
  with check (salesperson_id = auth.uid());

-- ---------------------------------------------------------------------------
-- appointments: visible if the parent opportunity belongs to the associate
-- ---------------------------------------------------------------------------
create policy appt_owner_all on appointments for all using (is_owner()) with check (is_owner());
create policy appt_assoc_select on appointments for select using (
  exists (select 1 from opportunities o where o.id = appointments.opportunity_id and o.salesperson_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- activities: visible if performed_by is the associate OR it's tied to one
-- of their assigned leads
-- ---------------------------------------------------------------------------
create policy activities_owner_all on activities for all using (is_owner()) with check (is_owner());
create policy activities_assoc_select on activities for select using (
  performed_by = auth.uid()
  or exists (select 1 from leads l where l.id = activities.lead_id and l.assigned_to = auth.uid())
);
create policy activities_assoc_insert on activities for insert with check (performed_by = auth.uid());

-- ---------------------------------------------------------------------------
-- follow_up_tasks: only the assigned associate (or owner) can see/complete
-- ---------------------------------------------------------------------------
create policy followup_owner_all on follow_up_tasks for all using (is_owner()) with check (is_owner());
create policy followup_assoc_select on follow_up_tasks for select using (assigned_to = auth.uid());
create policy followup_assoc_update on follow_up_tasks for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- ---------------------------------------------------------------------------
-- payments / jobs: FINANCIAL SYSTEM OF RECORD DATA.
-- Sales associates may see payments/jobs tied to their own opportunities
-- (needed for "cash influenced" on their personal scorecard) but never the
-- full company ledger.
-- ---------------------------------------------------------------------------
create policy payments_owner_all on payments for all using (is_owner()) with check (is_owner());
create policy payments_assoc_select on payments for select using (
  exists (select 1 from opportunities o where o.id = payments.opportunity_id and o.salesperson_id = auth.uid())
);

create policy jobs_owner_all on jobs for all using (is_owner()) with check (is_owner());
create policy jobs_assoc_select on jobs for select using (
  exists (select 1 from opportunities o where o.id = jobs.opportunity_id and o.salesperson_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- Owner-only tables: ad spend, goals, scorecard weights, integrations,
-- sync logs, audit log. A sales associate has no legitimate view here per
-- the role/permission matrix.
-- ---------------------------------------------------------------------------
create policy ad_spend_owner_only on ad_spend for all using (is_owner()) with check (is_owner());
create policy goals_owner_only on goals for all using (is_owner()) with check (is_owner());
create policy weights_owner_only on scorecard_weights for all using (is_owner()) with check (is_owner());
create policy integrations_owner_only on integrations for all using (is_owner()) with check (is_owner());
create policy sync_logs_owner_only on sync_logs for all using (is_owner()) with check (is_owner());
create policy audit_log_owner_only on audit_log for select using (is_owner());
create policy audit_log_insert_any on audit_log for insert with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- alerts: owner sees all; associate sees only alerts addressed to them
-- ---------------------------------------------------------------------------
create policy alerts_owner_all on alerts for all using (is_owner()) with check (is_owner());
create policy alerts_assoc_select on alerts for select using (owner_id = auth.uid());
create policy alerts_assoc_update on alerts for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- stage_history: owner sees all; associate sees history for their own
-- leads/opportunities only
-- ---------------------------------------------------------------------------
create policy stage_history_owner_all on stage_history for all using (is_owner()) with check (is_owner());
create policy stage_history_assoc_select on stage_history for select using (
  (entity_type = 'lead' and exists (
    select 1 from leads l where l.id = stage_history.entity_id and l.assigned_to = auth.uid()))
  or (entity_type = 'opportunity' and exists (
    select 1 from opportunities o where o.id = stage_history.entity_id and o.salesperson_id = auth.uid()))
);
