-- =============================================================================
-- Migration 0004: Reporting views
--
-- Convention: views expose DAILY-grain facts (or current-state facts). The
-- app layer (src/lib/kpi.ts) sums/aggregates the daily rows over whatever
-- date range the user selects (Today, This Week, custom range, etc.) rather
-- than baking a date range into SQL. This keeps one set of views correct for
-- every date filter instead of maintaining a view per range.
--
-- These views are believed correct and were validated against a local
-- Postgres instance with representative seed data (see supabase/seed.sql and
-- docs/testing-checklist.md). They have NOT been validated against a live
-- Supabase project or real GoHighLevel/Stripe/Urable data — that is real,
-- necessary human verification once integrations are connected (see
-- docs/known-limitations.md).
-- =============================================================================

-- Every stage transition an opportunity or lead has ever made, with how long
-- it dwelled in the stage it entered (open-ended stages use "now()").
create view v_stage_durations as
select
  entity_type,
  entity_id,
  to_stage as stage,
  changed_at as entered_at,
  coalesce(
    lead(changed_at) over (partition by entity_type, entity_id order by changed_at),
    now()
  ) as exited_at,
  coalesce(
    lead(changed_at) over (partition by entity_type, entity_id order by changed_at),
    now()
  ) - changed_at as duration
from stage_history;

create view v_avg_time_in_stage as
select entity_type, stage, avg(duration) as avg_duration, count(*) as samples
from v_stage_durations
group by entity_type, stage;

-- Net cash collected / deposits collected, currently attached to each
-- opportunity. "Net" = payments minus refunds, succeeded only.
create view v_opportunity_cash as
select
  o.id as opportunity_id,
  coalesce(sum(case
    when p.status = 'succeeded' and p.type in ('deposit', 'balance', 'full_payment') then p.amount_cents
    when p.status = 'succeeded' and p.type = 'refund' then -p.amount_cents
    else 0 end), 0) as cash_collected_cents,
  coalesce(sum(case
    when p.status = 'succeeded' and p.type = 'deposit' then p.amount_cents else 0 end), 0) as deposits_collected_cents,
  coalesce(sum(case
    when p.status = 'succeeded' and p.type = 'refund' then p.amount_cents else 0 end), 0) as refunded_cents
from opportunities o
left join payments p on p.opportunity_id = o.id
group by o.id;

-- Current funnel snapshot: how many opportunities sit in each stage right
-- now, and what revenue/cash is attached to them. Used by the sales-funnel
-- page's stage cards.
create view v_funnel_summary as
select
  o.stage,
  count(*) as opportunity_count,
  coalesce(sum(o.estimated_value_cents), 0) as revenue_attached_cents,
  coalesce(sum(oc.cash_collected_cents), 0) as cash_collected_cents
from opportunities o
left join v_opportunity_cash oc on oc.opportunity_id = o.id
group by o.stage;

-- Revenue SOLD by day = value of opportunities the day they crossed into
-- the 'sold' stage. This is distinct from cash collected and from
-- completed-job revenue — see docs/kpi-dictionary.md.
create view v_revenue_sold_daily as
select
  date(sh.changed_at) as day,
  coalesce(sum(o.estimated_value_cents), 0) as revenue_sold_cents,
  count(*) as deals_sold
from stage_history sh
join opportunities o on o.id = sh.entity_id and sh.entity_type = 'opportunity'
where sh.to_stage = 'sold'
group by date(sh.changed_at);

-- Cash collected / deposits collected / refunds by the day Stripe actually
-- processed the payment. This table is the ONLY source for "cash collected".
create view v_cash_collected_daily as
select
  date(processed_at) as day,
  coalesce(sum(case
    when status = 'succeeded' and type in ('deposit', 'balance', 'full_payment') then amount_cents
    when status = 'succeeded' and type = 'refund' then -amount_cents
    else 0 end), 0) as cash_collected_cents,
  coalesce(sum(case when status = 'succeeded' and type = 'deposit' then amount_cents else 0 end), 0) as deposits_collected_cents,
  coalesce(sum(case when status = 'succeeded' and type = 'refund' then amount_cents else 0 end), 0) as refunded_cents
from payments
where processed_at is not null
group by date(processed_at);

-- Completed-job revenue: only counts once Urable marks the job completed.
create view v_completed_job_revenue_daily as
select
  date(j.completed_at) as day,
  coalesce(sum(o.estimated_value_cents), 0) as completed_job_revenue_cents,
  count(*) as jobs_completed
from jobs j
join opportunities o on o.id = j.opportunity_id
where j.status = 'completed' and j.completed_at is not null
group by date(j.completed_at);

-- Per-salesperson daily activity (dials, connected calls, texts, emails).
create view v_activity_daily as
select
  performed_by,
  date(occurred_at) as day,
  count(*) filter (where type = 'dial') as dials,
  count(*) filter (where type = 'connected_call') as connected_calls,
  count(*) filter (where type = 'text') as texts,
  count(*) filter (where type = 'email') as emails
from activities
where performed_by is not null
group by performed_by, date(occurred_at);

-- Leads generated per day, by source.
create view v_leads_daily_by_source as
select
  date(l.created_at) as day,
  l.lead_source_id,
  ls.name as source_name,
  ls.category as source_category,
  count(*) as leads,
  count(*) filter (where l.attribution_missing) as missing_attribution_count
from leads l
left join lead_sources ls on ls.id = l.lead_source_id
group by date(l.created_at), l.lead_source_id, ls.name, ls.category;

-- Revenue sold / cash collected per day, by the lead's source — joins
-- through opportunities -> leads -> lead_sources.
create view v_opportunity_daily_by_source as
select
  date(sh.changed_at) as day,
  l.lead_source_id,
  ls.name as source_name,
  coalesce(sum(o.estimated_value_cents), 0) as revenue_sold_cents,
  coalesce(sum(oc.cash_collected_cents), 0) as cash_collected_cents,
  count(*) as deals_sold
from stage_history sh
join opportunities o on o.id = sh.entity_id and sh.entity_type = 'opportunity'
join leads l on l.id = o.lead_id
left join lead_sources ls on ls.id = l.lead_source_id
left join v_opportunity_cash oc on oc.opportunity_id = o.id
where sh.to_stage = 'sold'
group by date(sh.changed_at), l.lead_source_id, ls.name;

-- Appointment funnel by day: booked vs. confirmed vs. showed.
create view v_appointments_daily as
select
  date(scheduled_at) as day,
  count(*) as appointments_total,
  count(*) filter (where confirmed) as appointments_confirmed,
  count(*) filter (where showed is true) as appointments_showed,
  count(*) filter (where showed is false) as appointments_no_showed
from appointments
group by date(scheduled_at);
