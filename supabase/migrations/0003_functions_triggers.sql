-- =============================================================================
-- Migration 0003: Trigger utilities
--
-- Design decision (see docs/architecture.md "Risks and assumptions"):
-- The follow-up cadence engine (initial-contact cadence + hot/warm/cold
-- recall schedule) lives in application code — src/lib/followup-engine.ts —
-- not as a database trigger. It is invoked from one place: the server-side
-- lead/stage-change handlers (CRM webhook + manual UI actions). Duplicating
-- the same scheduling logic in both a DB trigger and the app would risk the
-- two drifting out of sync or double-inserting tasks. `next_non_sunday()`
-- below is still defined in SQL so it can be used by ad-hoc reporting
-- queries/backfills, and its logic is mirrored exactly in the TS version.
-- =============================================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();
create trigger trg_opps_updated before update on opportunities
  for each row execute function set_updated_at();
create trigger trg_appt_updated before update on appointments
  for each row execute function set_updated_at();
create trigger trg_goals_updated before update on goals
  for each row execute function set_updated_at();
create trigger trg_integrations_updated before update on integrations
  for each row execute function set_updated_at();

-- If a timestamp lands on a Sunday, push it to the same time on Monday.
-- The business is closed Sundays — nothing (appointments, follow-up tasks)
-- may ever be scheduled that day. Enforced again at the app layer and by
-- the CHECK constraints on appointments/follow_up_tasks.
create or replace function next_non_sunday(ts timestamptz) returns timestamptz
language sql immutable as $$
  select case
    when extract(dow from ts) = 0 then ts + interval '1 day'
    else ts
  end;
$$;

-- ---------------------------------------------------------------------------
-- Stage history logging — powers "average time in stage" and stage-leak
-- reporting. Fires on any stage change to leads or opportunities.
-- ---------------------------------------------------------------------------
create or replace function log_lead_stage_change() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT') or (old.stage is distinct from new.stage) then
    insert into stage_history (entity_type, entity_id, from_stage, to_stage)
    values ('lead', new.id, case when tg_op = 'INSERT' then null else old.stage end, new.stage);
  end if;
  return new;
end;
$$;

create trigger trg_leads_stage_history
  after insert or update of stage on leads
  for each row execute function log_lead_stage_change();

create or replace function log_opportunity_stage_change() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT') or (old.stage is distinct from new.stage) then
    insert into stage_history (entity_type, entity_id, from_stage, to_stage)
    values ('opportunity', new.id, case when tg_op = 'INSERT' then null else old.stage end, new.stage);
  end if;
  return new;
end;
$$;

create trigger trg_opps_stage_history
  after insert or update of stage on opportunities
  for each row execute function log_opportunity_stage_change();
