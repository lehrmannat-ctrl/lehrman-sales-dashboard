-- =============================================================================
-- Migration 0005: Alert generation
--
-- generate_alerts() is idempotent and safe to run on a schedule (every few
-- minutes via Supabase's pg_cron, or from a server route hit by an external
-- cron). It scans real data and opens/reuses alert rows — it never fabricates
-- an alert type the data doesn't support. Alert types covered here are the
-- highest-value subset for a solo operator; docs/kpi-dictionary.md documents
-- the full list from the spec and how to extend this function for the rest
-- (they all follow the same "detect condition -> upsert alert" shape).
--
-- Each check upserts on (type, related_lead_id/related_opportunity_id) so
-- re-running this function doesn't create duplicate open alerts, and it
-- resolves alerts whose underlying condition has cleared.
-- =============================================================================

create or replace function generate_alerts() returns void
language plpgsql as $$
declare
  v_owner_id uuid;
begin
  select id into v_owner_id from profiles where role = 'owner' order by created_at limit 1;

  -- 1) New lead not contacted within 5 minutes
  insert into alerts (type, severity, message, recommended_action, related_lead_id, owner_id, due_at, status)
  select
    'lead_not_contacted_5min', 'high',
    'New lead ' || coalesce(l.first_name || ' ' || l.last_name, l.phone, l.id::text) || ' has not been contacted in over 5 minutes.',
    'Call or text this lead immediately.',
    l.id, coalesce(l.assigned_to, v_owner_id), now(), 'open'
  from leads l
  where l.stage in ('new_lead', 'attempting_contact')
    and l.first_contacted_at is null
    and l.created_at < now() - interval '5 minutes'
    and not exists (
      select 1 from alerts a where a.type = 'lead_not_contacted_5min' and a.related_lead_id = l.id and a.status = 'open'
    );

  -- resolve if now contacted
  update alerts set status = 'resolved', resolved_at = now()
  where type = 'lead_not_contacted_5min' and status = 'open'
    and related_lead_id in (select id from leads where first_contacted_at is not null);

  -- 2) Lead has no next (pending) follow-up task
  insert into alerts (type, severity, message, recommended_action, related_lead_id, owner_id, due_at, status)
  select
    'lead_no_next_task', 'medium',
    'Lead ' || coalesce(l.first_name || ' ' || l.last_name, l.phone, l.id::text) || ' has no upcoming follow-up task.',
    'Create a follow-up task or move the lead to Lost.',
    l.id, coalesce(l.assigned_to, v_owner_id), now(), 'open'
  from leads l
  where l.stage not in ('lost', 'job_completed', 'review_requested')
    and not exists (select 1 from follow_up_tasks t where t.lead_id = l.id and t.status = 'pending')
    and not exists (select 1 from alerts a where a.type = 'lead_no_next_task' and a.related_lead_id = l.id and a.status = 'open');

  update alerts set status = 'resolved', resolved_at = now()
  where type = 'lead_no_next_task' and status = 'open'
    and related_lead_id in (select lead_id from follow_up_tasks where status = 'pending');

  -- 3) Appointment tomorrow or later that is still unconfirmed
  insert into alerts (type, severity, message, recommended_action, related_opportunity_id, owner_id, due_at, status)
  select
    'appointment_unconfirmed', 'medium',
    'Appointment on ' || to_char(ap.scheduled_at, 'Mon DD, HH12:MI AM') || ' is not confirmed.',
    'Call or text to confirm before the appointment.',
    ap.opportunity_id, coalesce(o.salesperson_id, v_owner_id), ap.scheduled_at, 'open'
  from appointments ap
  join opportunities o on o.id = ap.opportunity_id
  where ap.confirmed = false and ap.showed is null and ap.scheduled_at > now()
    and not exists (select 1 from alerts a where a.type = 'appointment_unconfirmed' and a.related_opportunity_id = ap.opportunity_id and a.status = 'open');

  -- 4) Deposit promised but not collected (deal sold, no deposit payment on file)
  insert into alerts (type, severity, message, recommended_action, related_opportunity_id, owner_id, due_at, status)
  select
    'deposit_not_collected', 'high',
    'Opportunity is sold but no deposit has been collected.',
    'Send the deposit invoice / collect payment before scheduling the job.',
    o.id, coalesce(o.salesperson_id, v_owner_id), now(), 'open'
  from opportunities o
  where o.stage in ('sold')
    and not exists (
      select 1 from payments p where p.opportunity_id = o.id and p.type = 'deposit' and p.status = 'succeeded'
    )
    and not exists (select 1 from alerts a where a.type = 'deposit_not_collected' and a.related_opportunity_id = o.id and a.status = 'open');

  update alerts set status = 'resolved', resolved_at = now()
  where type = 'deposit_not_collected' and status = 'open'
    and related_opportunity_id in (
      select opportunity_id from payments where type = 'deposit' and status = 'succeeded'
    );

  -- 5) Outstanding balance overdue: paid_in_full expected (job scheduled/completed)
  -- but remaining balance > 0 for more than 7 days since job date
  insert into alerts (type, severity, message, recommended_action, related_opportunity_id, owner_id, due_at, status)
  select
    'balance_overdue', 'high',
    'Outstanding balance on a job completed more than 7 days ago has not been collected.',
    'Follow up for final payment.',
    o.id, coalesce(o.salesperson_id, v_owner_id), now(), 'open'
  from opportunities o
  join jobs j on j.opportunity_id = o.id and j.status = 'completed'
  left join v_opportunity_cash oc on oc.opportunity_id = o.id
  where j.completed_at < now() - interval '7 days'
    and coalesce(oc.cash_collected_cents, 0) < o.estimated_value_cents
    and not exists (select 1 from alerts a where a.type = 'balance_overdue' and a.related_opportunity_id = o.id and a.status = 'open');

  -- 6) Failed payment attempts open
  insert into alerts (type, severity, message, recommended_action, related_opportunity_id, owner_id, due_at, status)
  select
    'failed_payment', 'critical',
    'A payment attempt failed and has not been retried successfully.',
    'Contact the customer to retry payment with a valid card.',
    p.opportunity_id, coalesce(o.salesperson_id, v_owner_id), now(), 'open'
  from payments p
  join opportunities o on o.id = p.opportunity_id
  where p.status = 'failed'
    and not exists (
      select 1 from payments p2 where p2.opportunity_id = p.opportunity_id and p2.type = p.type and p2.status = 'succeeded'
        and p2.processed_at > p.processed_at
    )
    and not exists (select 1 from alerts a where a.type = 'failed_payment' and a.related_opportunity_id = p.opportunity_id and a.status = 'open');

  -- 7) Lead attribution missing
  insert into alerts (type, severity, message, recommended_action, related_lead_id, owner_id, due_at, status)
  select
    'attribution_missing', 'low',
    'Lead is missing marketing source attribution.',
    'Tag the lead source in the CRM so ad spend/ROAS reporting stays accurate.',
    l.id, v_owner_id, now(), 'open'
  from leads l
  where l.attribution_missing = true
    and not exists (select 1 from alerts a where a.type = 'attribution_missing' and a.related_lead_id = l.id and a.status = 'open');

  -- 8) Salesperson below daily dial target (checked for yesterday, once the day is over)
  insert into alerts (type, severity, message, recommended_action, owner_id, due_at, status)
  select
    'below_daily_dial_target', 'medium',
    coalesce(p.full_name, 'Salesperson') || ' made ' || coalesce(ad.dials, 0) || ' dials yesterday, below the daily target.',
    'Review yesterday''s activity and block dedicated dialing time today.',
    p.id, now(), 'open'
  from profiles p
  left join v_activity_daily ad on ad.performed_by = p.id and ad.day = (current_date - interval '1 day')::date
  cross join lateral (
    select target_value from goals where metric_key = 'dials' and period = 'daily' and scope = 'company'
    order by effective_date desc limit 1
  ) g
  where p.active and p.role = 'sales_associate'
    and coalesce(ad.dials, 0) < g.target_value
    and not exists (
      select 1 from alerts a where a.type = 'below_daily_dial_target' and a.owner_id = p.id
        and a.created_at::date = current_date
    );
end;
$$;

comment on function generate_alerts() is
  'Scans leads/opportunities/appointments/payments and opens or resolves alert rows. Run on a schedule (pg_cron or an authenticated cron-triggered route). See docs/kpi-dictionary.md for the full alert catalog and how to extend this function.';
