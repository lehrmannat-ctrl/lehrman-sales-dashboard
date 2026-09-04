-- Real Ad -> Lead attribution requires knowing WHICH ad a lead came from,
-- not just which lead_source category (facebook_instagram_ads vs. e.g.
-- referral). That per-ad link does not exist anywhere yet. This column is
-- the landing spot for it, but it will stay null for every lead until the
-- owner's lead-capture form (in GoHighLevel or wherever leads are actually
-- submitted) is instrumented to pass through Meta's click id (fbclid) or a
-- matching UTM parameter -- see the attribution methodology write-up
-- (docs/marketing-attribution.md) for exactly what setup that requires.
alter table leads add column attributed_ad_id text;
comment on column leads.attributed_ad_id is 'Meta ad_id this lead is attributed to, if known. NULL for the vast majority of leads until the intake form is instrumented to capture fbclid/UTM at submission time -- see docs/marketing-attribution.md.';
