-- =============================================================================
-- Lehrman Mobile Detail — Sales Dashboard
-- Migration 0001: Core schema
--
-- Design notes:
--   * Every external-system record carries external_id + source_platform so
--     each system's data can be reconciled and re-synced without duplication.
--   * Money is stored in integer cents. Never store money as float.
--   * "Revenue sold", "cash collected", "deposits", "completed-job revenue",
--     and "refunds/cancellations" are NEVER the same column — see kpi views
--     in 0004_views.sql and docs/kpi-dictionary.md for the exact formulas.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles / roles
-- ---------------------------------------------------------------------------
create type user_role as enum ('owner', 'sales_associate');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'sales_associate',
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------------
create type lead_source_category as enum (
  'facebook_instagram_ads', 'google_ads', 'google_business_profile',
  'organic_social', 'website', 'referral', 'existing_customer',
  'dealership', 'fleet_commercial', 'walk_in', 'manual_entry', 'unknown'
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category lead_source_category not null default 'unknown',
  created_at timestamptz not null default now()
);

create type service_category as enum (
  'ceramic_coating', 'paint_correction', 'interior_detail', 'exterior_detail', 'mobile_detail'
);

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category service_category not null,
  base_price_cents integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pipeline stage enum — must match docs/kpi-dictionary.md funnel exactly
-- ---------------------------------------------------------------------------
create type pipeline_stage as enum (
  'new_lead', 'attempting_contact', 'contacted', 'qualified',
  'appointment_booked', 'appointment_confirmed', 'showed', 'sold',
  'deposit_collected', 'paid_in_full', 'job_completed',
  'review_requested', 'follow_up_or_next_service_due', 'lost'
);

create type lead_temperature as enum ('hot', 'warm', 'cold', 'unset');

-- ---------------------------------------------------------------------------
-- Leads (CRM is the system of record — GoHighLevel)
-- ---------------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  external_id text,                 -- GoHighLevel contact id
  source_platform text not null default 'manual',
  first_name text,
  last_name text,
  phone text,
  email text,
  lead_source_id uuid references lead_sources(id),
  attribution_missing boolean not null default false,
  assigned_to uuid references profiles(id),
  stage pipeline_stage not null default 'new_lead',
  temperature lead_temperature not null default 'unset',
  requested_booking_timeframe text,  -- customer's own words, e.g. "in 2 weeks"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  last_synced_at timestamptz,
  lost_reason text,
  unique (source_platform, external_id)
);

create index idx_leads_assigned_to on leads(assigned_to);
create index idx_leads_stage on leads(stage);
create index idx_leads_created_at on leads(created_at);
create index idx_leads_lead_source on leads(lead_source_id);

-- ---------------------------------------------------------------------------
-- Opportunities (one lead can have >1 opportunity over time, e.g. repeat customer)
-- ---------------------------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_platform text not null default 'manual',
  lead_id uuid not null references leads(id) on delete cascade,
  service_id uuid references services(id),
  vehicle_description text,
  estimated_value_cents integer not null default 0,
  stage pipeline_stage not null default 'new_lead',
  probability integer check (probability between 0 and 100),
  location text not null default 'Grand Rapids',
  salesperson_id uuid references profiles(id),
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  appointment_date timestamptz,
  job_date timestamptz,
  last_synced_at timestamptz
);

create index idx_opps_lead on opportunities(lead_id);
create index idx_opps_stage on opportunities(stage);
create index idx_opps_salesperson on opportunities(salesperson_id);
create index idx_opps_created_at on opportunities(created_at);

-- ---------------------------------------------------------------------------
-- Stage history — required for "average time in stage" and stage-leak
-- reporting on the funnel page. Populated by a trigger (0003) whenever
-- leads.stage or opportunities.stage changes.
-- ---------------------------------------------------------------------------
create table stage_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('lead', 'opportunity')),
  entity_id uuid not null,
  from_stage pipeline_stage,
  to_stage pipeline_stage not null,
  changed_at timestamptz not null default now()
);

create index idx_stage_history_entity on stage_history(entity_type, entity_id, changed_at);
create index idx_stage_history_to_stage on stage_history(to_stage, changed_at);

-- ---------------------------------------------------------------------------
-- Appointments (system of record — Urable)
-- ---------------------------------------------------------------------------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_platform text not null default 'urable',
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  scheduled_at timestamptz not null,
  confirmed boolean not null default false,
  showed boolean,
  no_show_reason text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  constraint appointments_not_on_sunday check (extract(dow from scheduled_at) <> 0)
);

create index idx_appt_opportunity on appointments(opportunity_id);
create index idx_appt_scheduled_at on appointments(scheduled_at);

-- ---------------------------------------------------------------------------
-- Activities: dials, connected calls, texts, emails, notes
-- (system of record for calls — Quo; CRM owns texts/emails/notes)
-- ---------------------------------------------------------------------------
create type activity_type as enum ('dial', 'connected_call', 'text', 'email', 'note');
create type activity_direction as enum ('outbound', 'inbound');

create table activities (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_platform text not null default 'manual',
  lead_id uuid references leads(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  performed_by uuid references profiles(id),
  type activity_type not null,
  direction activity_direction not null default 'outbound',
  outcome text,                       -- e.g. 'answered','voicemail','no_answer','busy'
  duration_seconds integer,
  recording_url text,
  campaign text,
  -- call quality review (manager coaching)
  cq_greeting integer check (cq_greeting between 0 and 5),
  cq_discovery integer check (cq_discovery between 0 and 5),
  cq_authority integer check (cq_authority between 0 and 5),
  cq_problem_identification integer check (cq_problem_identification between 0 and 5),
  cq_offer_presentation integer check (cq_offer_presentation between 0 and 5),
  cq_objection_handling integer check (cq_objection_handling between 0 and 5),
  cq_closing_attempt integer check (cq_closing_attempt between 0 and 5),
  cq_follow_up_set boolean,
  cq_overall_score numeric(4,2),
  cq_manager_feedback text,
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create index idx_activities_lead on activities(lead_id);
create index idx_activities_performed_by on activities(performed_by);
create index idx_activities_occurred_at on activities(occurred_at);
create index idx_activities_type on activities(type);

-- ---------------------------------------------------------------------------
-- Follow-up tasks (auto-generated cadence engine writes here — see
-- 0003_functions_triggers.sql and src/lib/followup-engine.ts)
-- ---------------------------------------------------------------------------
create type follow_up_status as enum ('pending', 'completed', 'skipped', 'canceled');

create table follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  assigned_to uuid references profiles(id),
  due_at timestamptz not null,
  cadence_rule text not null,   -- e.g. 'initial_contact_day3_am', 'hot_day7', 'cold_day30'
  status follow_up_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint follow_up_not_on_sunday check (extract(dow from due_at) <> 0)
);

create index idx_followup_lead on follow_up_tasks(lead_id);
create index idx_followup_assigned on follow_up_tasks(assigned_to);
create index idx_followup_due_at on follow_up_tasks(due_at);
create index idx_followup_status on follow_up_tasks(status);

-- ---------------------------------------------------------------------------
-- Payments (system of record — Stripe). This is the ONLY table that counts
-- as "cash collected". Nothing else may be summed into that KPI.
-- ---------------------------------------------------------------------------
create type payment_type as enum ('deposit', 'balance', 'full_payment', 'refund');
create type payment_status as enum ('succeeded', 'pending', 'failed', 'refunded');

create table payments (
  id uuid primary key default gen_random_uuid(),
  external_id text,                 -- Stripe payment_intent / charge id
  source_platform text not null default 'stripe',
  opportunity_id uuid references opportunities(id) on delete set null,
  amount_cents integer not null,    -- positive for payments, positive magnitude for refunds too (type distinguishes)
  type payment_type not null,
  status payment_status not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (source_platform, external_id)
);

create index idx_payments_opportunity on payments(opportunity_id);
create index idx_payments_processed_at on payments(processed_at);
create index idx_payments_status on payments(status);

-- ---------------------------------------------------------------------------
-- Jobs (system of record — Urable). A job's completion is what unlocks
-- "completed-job revenue" — separate from revenue sold and cash collected.
-- ---------------------------------------------------------------------------
create type job_status as enum ('scheduled', 'in_progress', 'completed', 'canceled');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_platform text not null default 'urable',
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  scheduled_at timestamptz,
  completed_at timestamptz,
  status job_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (source_platform, external_id)
);

create index idx_jobs_opportunity on jobs(opportunity_id);
create index idx_jobs_status on jobs(status);

-- ---------------------------------------------------------------------------
-- Ad spend (system of record — Meta Ads / Google Ads)
-- ---------------------------------------------------------------------------
create table ad_spend (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  platform text not null,           -- 'meta', 'google'
  campaign_name text,
  spend_date date not null,
  spend_cents integer not null default 0,
  leads_attributed integer not null default 0,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, external_id, spend_date)
);

create index idx_ad_spend_date on ad_spend(spend_date);
create index idx_ad_spend_platform on ad_spend(platform);

-- ---------------------------------------------------------------------------
-- Goals / targets (owner-editable, no code changes required)
-- ---------------------------------------------------------------------------
create type goal_period as enum ('daily', 'weekly', 'monthly');
create type goal_scope as enum ('company', 'salesperson', 'service', 'location');

create table goals (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,   -- e.g. 'revenue_sold','cash_collected','dials','close_rate'
  scope goal_scope not null default 'company',
  scope_id uuid,              -- profile id / service id / null for company+location(text below)
  scope_label text,           -- freeform, e.g. location name, when scope_id doesn't apply
  period goal_period not null,
  target_value numeric not null,
  effective_date date not null default current_date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_goals_metric on goals(metric_key, scope, period, effective_date desc);

-- ---------------------------------------------------------------------------
-- Scorecard weighting (single editable config row set)
-- ---------------------------------------------------------------------------
create table scorecard_weights (
  id uuid primary key default gen_random_uuid(),
  cash_collected_weight numeric not null default 0.25,
  close_rate_weight numeric not null default 0.20,
  avg_ticket_weight numeric not null default 0.15,
  follow_up_completion_weight numeric not null default 0.15,
  show_rate_weight numeric not null default 0.10,
  activity_target_weight numeric not null default 0.10,
  crm_data_accuracy_weight numeric not null default 0.05,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  constraint weights_sum_to_one check (
    abs(
      (cash_collected_weight + close_rate_weight + avg_ticket_weight +
       follow_up_completion_weight + show_rate_weight + activity_target_weight +
       crm_data_accuracy_weight) - 1.0
    ) < 0.0001
  )
);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
create type alert_severity as enum ('low', 'medium', 'high', 'critical');
create type alert_status as enum ('open', 'acknowledged', 'resolved');

create table alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,   -- e.g. 'lead_not_contacted_5min','deposit_missing','sync_failed'
  severity alert_severity not null default 'medium',
  message text not null,
  recommended_action text,
  related_lead_id uuid references leads(id) on delete cascade,
  related_opportunity_id uuid references opportunities(id) on delete cascade,
  owner_id uuid references profiles(id),
  due_at timestamptz,
  status alert_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index idx_alerts_status on alerts(status);
create index idx_alerts_severity on alerts(severity);
create index idx_alerts_owner on alerts(owner_id);

-- ---------------------------------------------------------------------------
-- Integrations + sync logs
-- ---------------------------------------------------------------------------
create type integration_status as enum ('not_connected', 'connected', 'error');

create table integrations (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique,  -- 'gohighlevel','quo','stripe','urable','meta_ads'
  status integration_status not null default 'not_connected',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  records_synced_total bigint not null default 0,
  config jsonb not null default '{}'::jsonb,  -- non-secret metadata only (e.g. location id)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running', -- 'running','success','partial','failed'
  records_synced integer not null default 0,
  error_message text
);

create index idx_sync_logs_integration on sync_logs(integration_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_entity on audit_log(entity_type, entity_id);

-- Seed the five known integrations as "not_connected" — never fabricate a
-- connected state. The integration settings page reflects this table exactly.
insert into integrations (platform, status) values
  ('gohighlevel', 'not_connected'),
  ('quo', 'not_connected'),
  ('stripe', 'not_connected'),
  ('urable', 'not_connected'),
  ('meta_ads', 'not_connected');

insert into scorecard_weights (cash_collected_weight, close_rate_weight, avg_ticket_weight,
  follow_up_completion_weight, show_rate_weight, activity_target_weight, crm_data_accuracy_weight)
values (0.25, 0.20, 0.15, 0.15, 0.10, 0.10, 0.05);
