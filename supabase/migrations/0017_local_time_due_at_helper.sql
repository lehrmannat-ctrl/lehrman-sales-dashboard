-- The initial-contact and recall cadence triggers previously computed
-- "due at" times as a fixed UTC offset (date_trunc('day', now()) + interval
-- '9 hours'), which is wrong on two counts: (1) it's 9am/5pm UTC, not
-- local time at all, and (2) even if it were meant as local time, a fixed
-- offset doesn't account for EST/EDT. This adds a timezone-aware helper and
-- rewrites both trigger functions to use it for the owner's requested
-- morning=11:30am / afternoon=4:30pm America/New_York due times.
--
-- This does NOT change how many tasks are generated or their cadence/day
-- spacing -- only the time-of-day portion of `due_at`.

create or replace function public.local_due_at(
  base timestamptz,
  day_offset integer,
  due_hour integer,
  due_minute integer,
  tz text default 'America/New_York'
) returns timestamptz
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_local_date date;
begin
  -- Calendar date `day_offset` days after `base`, as a date in `tz` (not UTC).
  v_local_date := ((base at time zone tz)::date) + day_offset;
  -- Interpret due_hour:due_minute as local wall-clock time on that date, then
  -- convert to a UTC instant -- `at time zone` resolves DST correctly per the
  -- IANA tz rules in effect on that specific date.
  return (v_local_date + make_time(due_hour, due_minute, 0)) at time zone tz;
end;
$$;

create or replace function public.handle_lead_stage_change()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_base timestamptz := now();
  v_day integer;
begin
  if new.stage = 'attempting_contact'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    for v_day in 0..4 loop
      insert into follow_up_tasks (lead_id, assigned_to, due_at, cadence_rule)
      values (
        new.id, new.assigned_to,
        next_non_sunday(local_due_at(v_base, v_day, 11, 30)),
        'initial_contact_day' || (v_day + 1) || '_am'
      );
      insert into follow_up_tasks (lead_id, assigned_to, due_at, cadence_rule)
      values (
        new.id, new.assigned_to,
        next_non_sunday(local_due_at(v_base, v_day, 16, 30)),
        'initial_contact_day' || (v_day + 1) || '_pm'
      );
    end loop;
  end if;

  if tg_op = 'UPDATE' and old.stage = 'attempting_contact' and new.stage is distinct from old.stage then
    update follow_up_tasks
      set status = 'canceled'
      where lead_id = new.id
        and status = 'pending'
        and cadence_rule like 'initial_contact_%';
  end if;

  return new;
end;
$$;

create or replace function public.handle_lead_temperature_change()
returns trigger
language plpgsql
set search_path to 'public'
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
        next_non_sunday(local_due_at(v_base, v_day, 11, 30)),
        new.temperature::text || '_recall_day' || v_day
      );
    end loop;
  end if;

  return new;
end;
$$;
