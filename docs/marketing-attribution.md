# Marketing Attribution: Ad → Lead → Booking → Customer → Revenue

The owner's goal is to move past "which ad had the cheapest cost-per-lead"
and answer "which ad actually produced the most valuable customers." This
doc is an honest account of what the current schema can and cannot support,
so Claude (in the daily/weekly/monthly marketing audits) never invents a
connection the data doesn't actually have.

## The chain, and where it breaks today

```
   Meta Ad  --?-->  Lead  ------>  Opportunity  ------>  Job / Payment
 (ad_id)         (leads row)     (opportunities)      (jobs, payments)
```

Every link to the right of "Lead" is solid:

- **Lead → Opportunity**: `opportunities.lead_id` — reliable, already
  populated by the GoHighLevel adapter.
- **Opportunity → Booking**: `jobs.opportunity_id` — reliable when Urable
  has been given the opportunity id at booking time (see
  `docs/integration-setup-guide.md`'s Urable section). As of migration
  0018, a job with NO opportunity id (a customer who booked directly
  through Urable) still exists in the data, but it then has **no path back
  to any lead or ad at all** — it's a dead end for attribution purposes,
  not a gap that can be papered over.
- **Opportunity → Revenue**: `payments.opportunity_id` — reliable when
  Stripe's PaymentIntent metadata carries the opportunity id (see Stripe
  setup).

The link that is **not** solid is the first one: **Ad → Lead.**

Today, a lead only carries `lead_source_id`, which points to a *category*
(`facebook_instagram_ads`, `google_ads`, `referral`, etc.) — not a specific
ad, ad set, or campaign. `leads.attributed_ad_id` (added in migration 0020)
is the column that *would* carry that, but it is null for virtually every
lead, because nothing today writes it. Getting real values into it requires
one specific piece of setup that only the owner (or whoever manages the
lead-capture form / GoHighLevel funnel) can do:

### What's required to close this gap

1. **Every ad's destination URL needs to preserve Meta's click id.** Meta
   already appends `fbclid=...` to the URL when someone clicks an ad, as
   long as the ad's link isn't rewritten by a redirect that drops query
   parameters. Confirm the landing page/form (in GoHighLevel or wherever
   leads are actually submitted) doesn't strip it.
2. **The lead-capture form needs to save that id somewhere retrievable at
   submission time** — a hidden form field that reads `fbclid` from the
   page URL and submits it alongside the name/phone/email, landing in a
   custom field GoHighLevel already has room for.
3. **The GoHighLevel webhook payload needs to include that custom field**,
   and `src/lib/integrations/gohighlevel.ts`'s lead-creation code needs a
   small addition to copy it into `leads.attributed_ad_id`. This last part
   is a code change Claude can make once steps 1–2 exist and the field's
   actual name in GoHighLevel is known — it hasn't been guessed at here
   because guessing a wrong field name would silently produce fake data,
   which is exactly what the owner asked not to happen.
4. Alternative if fbclid capture turns out to be impractical: UTM
   parameters (`utm_content` = ad name, `utm_term` = ad set, etc.) set
   manually per ad in Meta Ads Manager, captured the same way. Less
   precise (relies on consistent manual tagging) but far simpler to set up
   than parsing fbclid.

**Until one of those exists, Claude will not claim a specific booking came
from a specific ad.** What Claude *can* do reliably today, and will use in
the audits instead:

## The best available methodology today (no fbclid/UTM capture yet)

**Category-level, not ad-level, revenue attribution:**
`leads.lead_source_id` → `lead_sources.category` (e.g.
`facebook_instagram_ads`) is reliable today. Joining
leads → opportunities → jobs/payments by category gives a real, honest
answer to "how much revenue came from Facebook/Instagram leads overall this
month" — just not broken down by which specific ad within that channel.

**Ad-level, spend-side-only comparison:** `ad_performance_daily` (synced by
the Meta adapter) gives real, per-ad spend/impressions/CPM/CTR/CPC and
Meta's own `meta_leads` count. This is legitimate for comparing ads against
*each other* on efficiency (which ad has a rising CPL, which is losing reach
to frequency fatigue, which one Meta itself credits with more leads) — it
is Meta's self-reported number, so it's labeled as such and never presented
as if it were confirmed CRM bookings.

**What the audits will explicitly avoid doing:** blending the category-level
CRM revenue number with the ad-level Meta spend number to produce a
false-precision "ROAS per ad." That would require assuming leads split
across ads within a category in the same proportion Meta reports —
an assumption, not a measurement. When the audits report ROAS, it will be
at the category level (real leads, real revenue) or spend-efficiency at the
ad level (real spend, Meta's own lead count) — never both combined into one
ad-level revenue figure unless the fbclid/UTM work above gets done.

## Summary for the owner

| Question | Answerable today? | With what |
|---|---|---|
| How much did we spend on Facebook/Instagram ads this month? | Yes | `ad_spend` / `ad_performance_daily` |
| Which specific ad has the best CPM/CTR/CPL (Meta's own count)? | Yes | `ad_performance_daily` |
| How much revenue came from Facebook/Instagram leads overall? | Yes | `leads.lead_source_id` → `opportunities` → `jobs`/`payments` |
| Which specific ad produced our highest-value customers? | **No — requires fbclid/UTM capture (steps 1-3 above)** | n/a until then |
| What's the true revenue from a direct Urable booking with no CRM lead? | Partially — `jobs.quoted_amount_cents` (Urable's quote), not confirmed cash collected | `jobs` (migration 0018) |
