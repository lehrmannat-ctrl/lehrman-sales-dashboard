-- =============================================================================
-- Migration 0007: Lead-stage funnel view
--
-- v_funnel_summary (0004) only covers opportunities, which don't exist
-- until a lead reaches 'qualified' (see docs/architecture.md). The earliest
-- funnel stages (new_lead, attempting_contact, contacted) live on the lead
-- record itself, so the funnel page needs this counterpart view to show
-- the whole top-of-funnel, not just the part that became a priced deal.
-- =============================================================================

create view v_lead_funnel_summary as
select
  stage,
  count(*) as lead_count
from leads
group by stage;

-- "Ever reached this stage" counts (cumulative, not just current) for both
-- leads and opportunities — this is what the funnel-leak analysis should
-- use as its denominator, not the current snapshot count, since a lead
-- that has since moved on should still count as having passed through.
create view v_stage_ever_reached as
select entity_type, stage, count(*) as ever_reached_count
from v_stage_durations
group by entity_type, stage;
