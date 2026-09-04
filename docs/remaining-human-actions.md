# Remaining Human Actions

Things only Nathaniel (or a developer he brings in) can do — no amount of
further code-writing substitutes for these:

1. **Create the Supabase project** and run the migrations
   (`docs/deployment-guide.md` §1).
2. **Run `npm install` and `npm run dev` for the first time** — this
   codebase has never been through a real Node/npm install (sandbox had no
   registry access). Fix whatever surfaces.
3. **Get API credentials** for GoHighLevel, Quo, Stripe, Urable, and Meta
   Ads, and work through `docs/integration-setup-guide.md` for each —
   including the parts that need account-specific decisions (GHL pipeline
   stage names, how Urable jobs will carry an opportunity id, Quo's actual
   API shape).
4. **Decide the login model**: does every login get created manually by
   Nathaniel, or is there a self-signup flow? (Recommendation: manual,
   given it's a 1-2 person team — simpler and safer.) **Resolved**: logins
   are created manually (Supabase Dashboard → Authentication → Users → Add
   user) — migration 0009 auto-creates a matching `profiles` row for any new
   login, defaulting to the least-privileged role (`sales_associate`).
   Promoting a specific person to `owner` is still a deliberate manual SQL
   step, done once, right after their login is created.
5. **Set real targets** on `/settings/goals` — the seeded goals
   ($25k/month revenue, etc.) are placeholders from the original spec, not
   necessarily what should stay long-term.
6. **Choose a hosting provider** and set environment variables there
   (`docs/deployment-guide.md` §4).
7. **Wire up the scheduled sync** (`/api/cron/sync`) to an actual
   scheduler.
8. **Decide on a backup strategy** beyond Supabase's own plan-tier backups.
9. **Test as both roles** — log in as owner and (once a second login
   exists) as a sales_associate, and confirm the boundaries in
   `docs/role-permission-matrix.md` hold in practice, not just in the SQL.
10. **Point Urable/GoHighLevel/Meta at the new shop location** once the
    October 1 move happens, and add a second `location` value if revenue
    should ever be split mobile-vs-shop (the schema already has a
    `location` field on `opportunities` ready for this).
