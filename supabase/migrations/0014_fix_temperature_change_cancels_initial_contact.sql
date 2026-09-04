-- =============================================================================
-- Migration 0014: Fix - tagging a lead hot/warm/cold didn't cancel its
-- leftover Initial Contact call-back tasks
--
-- Bug (reported by the owner 2026-09-01): handle_lead_stage_change()
-- (migration 0011) only cancels pending 'initial_contact_%' tasks when the
-- `stage` column itself moves away from 'attempting_contact'. In practice,
-- a lead gets tagged hot/warm/cold via the `temperature` column WITHOUT its
-- `stage` column being changed at the same time (e.g. GoHighLevel updates
-- temperature through a workflow/tag while the pipeline stage lags behind,
-- or the owner sets it manually) - so the AM/PM Initial Contact tasks were
-- never getting canceled, and a lead ended up with both cadences running at
-- once.
--
-- Fix: whenever a lead is tagged hot, warm, or cold, that alone means
-- "we've made contact and classified this lead" - so cancel any pending
-- initial_contact_% tasks (and the one-off new_lead_contact task, for the
-- same reason) right there in handle_lead_temperature_change(), independent
-- of whatever the stage column says. This doesn't touch handle_lead_stage_
-- change() at all - that trigger's own cancellation logic still fires
-- correctly when stage actually changes; this just adds the missing case.
-- =============================================================================

create or replace function handle_lead_temperature_change() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_base timestamptz := now();
  v_day integer;
  v_days integer[];
  v_old_temperature text;
begin
  v_old_temperature := case when tg_op = 'UPDATE' then old.temperature::text else null end;

  -- Only act on a real transition (or a brand-new lead already tagged on insert).
  if tg_op = 'INSERT' then
    if new.temperature not in ('hot', 'warm', 'cold') then
      return new;
    end if;
  else
    if old.temperature is not distinct from new.temperature then
      return new;
    end if;
  end if;

  -- Moving to a new temperature category cancels whatever recall calls were
  -- still queued for the old one - a lead is only ever in one temperature at
  -- a time, so it shouldn't have two overlapping call-back schedules.
  if v_old_temperature in ('hot', 'warm', 'cold') then
    update follow_up_tasks
      set status = 'canceled'
      where lead_id = new.id
        and status = 'pending'
        and cadence_rule like v_old_temperature || '_recall_%';
  end if;

  -- Fix for migration 0014: being tagged hot/warm/cold at all means this
  -- lead is past "trying to make first contact" - cancel whatever's left of
  -- that job regardless of what the `stage` column happens to say, so it
  -- doesn't keep generating morning/afternoon call-backs alongside its new
  -- recall cadence.
  if new.temperature in ('hot', 'warm', 'cold') then
    update follow_up_tasks
      set status = 'canceled'
      where lead_id = new.id
        and status = 'pending'
        and (cadence_rule like 'initial_contact_%' or cadence_rule = 'new_lead_contact');
  end if;

  v_days := case new.temperature
    when 'hot' then array[3, 7, 10, 14]
    when 'warm' then array[7, 14, 21]
    when 'cold' then array[15, 30, 60]
    else null
  end;

  if v_days is not null then
    foreach v_day in array v_days loop
      insert into follow_up_tasks (lead_id, assigned_to, due_at, cadence_rule)
      values (
        new.id, new.assigned_to,
        next_non_sunday(date_trunc('day', v_base) + (v_day || ' days')::interval + interval '9 hours'),
        new.temperature::text || '_recall_day' || v_day
      );
    end loop;
  end if;

  return new;
end;
$$;
