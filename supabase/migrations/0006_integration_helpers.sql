-- =============================================================================
-- Migration 0006: Integration bookkeeping helper
--
-- Used by src/lib/integrations/registry.ts to bump records_synced_total
-- without a read-modify-write race between concurrent sync runs.
-- =============================================================================

create or replace function increment_integration_records_synced(p_integration_id uuid, p_count integer)
returns void
language sql
security definer
set search_path = public
as $$
  update integrations
  set records_synced_total = records_synced_total + p_count,
      updated_at = now()
  where id = p_integration_id;
$$;
