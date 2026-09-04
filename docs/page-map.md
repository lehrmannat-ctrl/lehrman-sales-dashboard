# Page Map

| Route | Purpose | Role |
|---|---|---|
| `/login` | Sign in | Public |
| `/dashboard` | Executive dashboard — 20 KPI cards, date filter | Owner |
| `/funnel` | Full sales funnel with leak detection | Owner (associate sees their own slice via RLS if granted access later) |
| `/revenue` | Revenue/cash breakdown by service, salesperson, source | Owner |
| `/scorecards` | Ranked, weighted salesperson scorecards | Owner (all), Associate (own row only, via RLS) |
| `/pipeline` | Kanban + table pipeline, stage editable inline | Owner (all), Associate (own deals) |
| `/daily` | Daily Command Center — today's action items | Owner (all), Associate (own leads) |
| `/sources` | Lead source performance, CAC, ROAS | Owner |
| `/calls` | Call activity log + recordings + quality review | Owner |
| `/forecast` | Conservative/expected/aggressive revenue forecast | Owner |
| `/alerts` | Open alerts, resolve action | Owner (all), Associate (own) |
| `/settings/goals` | Edit targets and scorecard weights | Owner |
| `/settings/integrations` | Connection status, manual resync, sync log | Owner |
| `/api/webhooks/stripe` | Real-time payment webhook | System |
| `/api/webhooks/gohighlevel` | Real-time CRM webhook | System |
| `/api/cron/sync` | Scheduled integration sync + alert refresh | System (CRON_SECRET) |

Middleware (`src/middleware.ts`) redirects a `sales_associate` away from
owner-only prefixes (`/revenue`, `/sources`, `/calls`, `/forecast`,
`/settings/*`) to `/daily` rather than rendering an empty page — RLS would
return no rows either way, but a clear redirect signals a permission
boundary instead of what could look like a bug.
