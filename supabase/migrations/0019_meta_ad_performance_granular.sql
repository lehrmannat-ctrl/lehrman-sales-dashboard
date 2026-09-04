-- Ad-set/ad-level performance detail, separate from the existing
-- campaign-level `ad_spend` table (which stays as-is -- it's already read
-- by getLeadSourceReport). This is the grain the owner's marketing-audit
-- automations (daily/weekly/monthly Slack reports) need: "is Ad X getting
-- worse" is not answerable from a campaign-level rollup alone.

create table ad_performance_daily (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'meta',
  campaign_id text not null,
  campaign_name text,
  adset_id text not null,
  adset_name text,
  ad_id text not null,
  ad_name text,
  spend_date date not null,
  impressions integer not null default 0,
  reach integer not null default 0,
  frequency numeric,
  spend_cents integer not null default 0,
  link_clicks integer not null default 0,
  clicks integer not null default 0,
  -- Count of lead events attributed by Meta itself to this ad (on-platform
  -- lead forms, or a configured website "Lead" custom conversion). This is
  -- Meta's own attribution, which can disagree with the CRM's -- see the
  -- adapter's doc comment and the attribution methodology write-up for why
  -- both numbers are kept rather than silently picking one.
  meta_leads integer not null default 0,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, ad_id, spend_date)
);

alter table ad_performance_daily enable row level security;

create policy ad_performance_daily_owner_read on ad_performance_daily
  for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'owner'));

create index idx_ad_performance_daily_date on ad_performance_daily (spend_date);
create index idx_ad_performance_daily_adset on ad_performance_daily (adset_id, spend_date);
create index idx_ad_performance_daily_campaign on ad_performance_daily (campaign_id, spend_date);
