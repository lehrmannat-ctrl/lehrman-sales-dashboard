-- QuickBooks-sourced P&L snapshots for the Owner Dashboard's simple P&L
-- section. One row per (period_type, period_label) pair, overwritten on
-- every sync -- this is a snapshot of "as of last sync", not a ledger.
--
-- NOTE ON REPO/DB DRIFT: migrations 0011-0013 and "manual_tasks" (which
-- would have been 0015) were applied directly to the live Supabase project
-- in an earlier session without a matching file being committed here (see
-- `supabase migration list` / the Supabase dashboard for their actual SQL:
-- followup_cadence_triggers, add_vehicle_field_to_leads,
-- call_summary_infrastructure, manual_tasks). This file continues the
-- numbering from 0014 and does not attempt to backfill those four.

create type financial_period_type as enum ('month', 'ytd');

create table financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null default 'quickbooks',
  period_type financial_period_type not null,
  period_label text not null, -- e.g. '2026-09' for a month, '2026' for ytd
  period_start date not null,
  period_end date not null,
  revenue_cents integer not null default 0,
  supplies_cents integer not null default 0,
  labor_cents integer not null default 0,
  marketing_cents integer not null default 0,
  rent_cents integer not null default 0,
  other_cents integer not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_platform, period_type, period_label)
);

alter table financial_snapshots enable row level security;

-- Financials are owner-only, matching view_company_revenue elsewhere.
create policy financial_snapshots_owner_read on financial_snapshots
  for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'owner'));

-- Register the 6th integration platform so the existing sync/registry
-- machinery (integrations, sync_logs) picks it up the same way as the other five.
insert into integrations (platform, status) values ('quickbooks', 'not_connected')
  on conflict (platform) do nothing;
