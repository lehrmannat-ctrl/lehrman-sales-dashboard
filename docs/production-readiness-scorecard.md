# Production-Readiness Scorecard

| Area | Status | Notes |
|---|---|---|
| Database schema & migrations | ✅ Done, executed against real Postgres | 7 migrations, all applied cleanly |
| Row Level Security | ✅ Written and applied | Not yet exercised through real authenticated sessions (needs live Supabase Auth) |
| Seed / demo data | ✅ Done | Realistic solo-operator volume; simplification noted in known-limitations.md |
| KPI calculations | ✅ Written and executed/validated | See testing-checklist.md |
| Follow-up cadence engine | ✅ Written and executed/validated | Sunday-skip and cadence math confirmed correct |
| Alert generation | ✅ Written and executed/validated | 8 of ~16 spec alert types implemented |
| Executive dashboard, funnel, revenue, scorecards, pipeline, daily command center pages | ✅ Built | Not yet visually verified in a browser |
| Lead source, calls, forecast, alerts, goals, integrations settings pages | ✅ Built | Same caveat |
| Role-based access (app layer) | ✅ Built | `src/lib/permissions.ts`, `src/middleware.ts` |
| Integration adapters (interface + Stripe) | ✅ Built, Stripe highest confidence | Not tested against a live account |
| Integration adapters (GHL, Quo, Urable, Meta) | ⚠️ Best-effort, unverified | Explicit TODO(verify) markers; do not trust "connected" without live testing |
| Webhooks (Stripe, GoHighLevel) | ✅ Built, signature verification validated | Payload shape for GHL is a best guess pending real payload |
| Scheduled sync / alert refresh endpoint | ✅ Built | Not yet wired to a real scheduler |
| `npm install` / `next build` / `next dev` | ❌ Never run | No npm registry access in this sandbox — first required step |
| Mobile/tablet responsive testing | ❌ Not visually verified | Tailwind responsive classes used throughout |
| Security review | ⚠️ Partial | Two independent permission layers exist by design; Supabase's automated advisor scan found + fixed real issues (13 views were SECURITY DEFINER instead of respecting caller RLS, 5 functions had a mutable search_path) via migration 0008; re-scanned clean except 2 expected low-risk warnings (`auth_role`/`is_owner` are callable by any logged-in user, but only ever return that same user's own role, needed by RLS itself — see docs/known-limitations.md). No external pen-test. |
| Backup strategy | ❌ Not set up | Depends on chosen Supabase plan tier |
| Deployment | ❌ Not deployed | See deployment-guide.md |

**Overall: a real, executed-and-validated backend and a complete,
consistent application layer — not yet a running, deployed product.** The
single highest-value next step is running `npm install && npm run dev`
against a real Supabase project and working through
`docs/testing-checklist.md`'s unchecked items in order.
