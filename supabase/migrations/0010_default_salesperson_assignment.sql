-- =============================================================================
-- Migration 0010: Auto-assign new leads/opportunities when there's exactly
-- one active sales associate
--
-- Right now this is a genuinely 1-2 person team. Every integration adapter
-- (GoHighLevel today, Urable/Quo/webhooks later) would otherwise need its
-- own copy of "who does this go to" logic, and every one of them would need
-- updating the day a second associate joins. Putting it here instead means:
-- it applies no matter which code path inserts a lead or opportunity, and
-- it only ever guesses when the guess is unambiguous - with zero or more
-- than one active sales_associate, it leaves assigned_to/salesperson_id
-- alone rather than assign to the wrong person. This never touches an
-- existing row (BEFORE INSERT only), so a real second associate's
-- assignments are never overwritten by this.
-- =============================================================================

create or replace function assign_default_salesperson() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_default_id uuid;
  v_active_count integer;
begin
  if new.assigned_to is null then
    select count(*) into v_active_count from profiles where role = 'sales_associate' and active;
    if v_active_count = 1 then
      select id into v_default_id from profiles where role = 'sales_associate' and active limit 1;
      new.assigned_to := v_default_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_leads_default_assignment
  before insert on leads
  for each row execute function assign_default_salesperson();

create or replace function assign_default_opportunity_salesperson() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_default_id uuid;
  v_active_count integer;
begin
  if new.salesperson_id is null then
    select count(*) into v_active_count from profiles where role = 'sales_associate' and active;
    if v_active_count = 1 then
      select id into v_default_id from profiles where role = 'sales_associate' and active limit 1;
      new.salesperson_id := v_default_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_opportunities_default_assignment
  before insert on opportunities
  for each row execute function assign_default_opportunity_salesperson();
