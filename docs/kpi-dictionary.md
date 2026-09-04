# KPI Dictionary

Every formula here has a matching implementation in `src/lib/kpi.ts` (pure
calculations) and `src/lib/queries.ts` (data access). If you change one,
change both.

## Top KPI cards (Executive Dashboard)

| KPI | Formula | Source |
|---|---|---|
| New Leads | count of `leads` created in range | `leads.created_at` |
| Total Dials | count of `activities` where `type='dial'` in range | `activities` |
| Connected Calls | count of `activities` where `type='connected_call'` in range | `activities` |
| Meaningful Conversations | connected calls with `duration_seconds >= 90` (a proxy — a call under 90s rarely covers discovery; adjust the threshold in `getRawKpiInputs()` if the business finds a different cutoff more honest) | `activities` |
| Appointments Booked | count of `appointments` scheduled in range | `appointments` |
| Appointments Showed | of those, `showed = true` | `appointments` |
| Deals Closed | count of stage transitions to `sold` in range | `stage_history` |
| Revenue Sold | sum of `estimated_value_cents` for opportunities the day they hit `sold` | `v_revenue_sold_daily` |
| Cash Collected | sum of succeeded Stripe payments (deposit+balance+full) minus refunds, by day processed | `v_cash_collected_daily` |
| Deposits Collected | subset of Cash Collected where `type='deposit'` | `v_cash_collected_daily` |
| Outstanding Balance | `estimated_value_cents - cash_collected_cents` for opportunities in `sold`/`deposit_collected`, summed, floored at 0 | live query |
| Average Ticket | Revenue Sold ÷ Deals Closed | `averageTicket()` |
| Close Rate | Deals Closed ÷ Appointments Showed | `closeRate()` |
| Show Rate | Appointments Showed ÷ Appointments Booked | `showRate()` |
| Contact Rate | Connected Calls ÷ New Leads | `contactRate()` |
| Speed to Lead | median minutes between `leads.created_at` and `leads.first_contacted_at` for leads created in range | `getSpeedToLeadMinutes()` |
| Revenue per Lead | Revenue Sold ÷ New Leads | `revenuePerLead()` |
| Cash per Lead | Cash Collected ÷ New Leads | `cashPerLead()` |
| Revenue per Appointment | Revenue Sold ÷ Appointments Booked | `revenuePerAppointment()` |
| Cash per Appointment | Cash Collected ÷ Appointments Booked | `cashPerAppointment()` |

Every card also shows: goal (from `goals` table, or "no goal set" — never a
guessed color), difference from goal, % change vs. the previous comparable
period (see `src/lib/date-ranges.ts`), and a status color:

- **Green ("good")**: at or above 95% of goal.
- **Yellow ("warn")**: at or above 80% of goal.
- **Red ("bad")**: below 80% of goal.
- **Gray ("no goal")**: no target has been set for this metric/period —
  shown honestly rather than colored arbitrarily.

## The six revenue/cash numbers (never combined)

See `docs/architecture.md` section 3 for the full explanation. In one line
each:

1. Revenue Sold — priced, not necessarily paid.
2. Cash Collected — actually paid, per Stripe, net of refunds.
3. Deposits Collected — the deposit portion of #2.
4. Outstanding A/R — #1 minus #2, only for sold-or-later deals.
5. Completed-Job Revenue — only counts once Urable marks the job done.
6. Refunded/Canceled — money given back or a deal that fell through.

## Sales funnel example (from the spec)

> "82 leads were generated, but only 31 were contacted. Contact rate is
> 37.8%, which is below the 65% target."

This is computed as: `contacted_count / new_leads_count`, using
`v_stage_ever_reached` (cumulative — a lead that has since moved past
"contacted" still counts as having been contacted), not the current
snapshot. The funnel page (`/funnel`) surfaces the single largest
percentage drop between consecutive stages automatically as "Biggest leak."

## Scorecard weighting

Default weights (owner-editable at `/settings/goals`, enforced to sum to
1.0 by both the UI and a database `CHECK` constraint):

- Cash Collected: 25%
- Close Rate: 20%
- Average Ticket: 15%
- Follow-up Completion: 15%
- Show Rate: 10%
- Activity Target: 10%
- CRM Data Accuracy: 5%

Each input is normalized to "% of its own goal, capped at 100" before being
weighted — see `weightedScorecardScore()` in `src/lib/kpi.ts`. CRM Data
Accuracy is currently a placeholder fixed at 100 — wiring it to a real
data-quality check (missing attribution %, stale-lead %) is listed in
`docs/known-limitations.md`.

## Follow-up cadence rules

See `docs/architecture.md` section 4, and `src/lib/followup-engine.ts` for
the exact, executed-and-verified implementation.

## Forecasting assumptions

`src/lib/kpi.ts`'s `computeForecast()`:

- **Conservative** = revenue sold so far this month (assumes nothing else
  in the open pipeline closes).
- **Expected** = conservative + (open pipeline value × historical close
  rate).
- **Aggressive** = conservative + (open pipeline value × min(100%,
  historical close rate × 1.5)).
- Historical close rate, average ticket, lead-to-deal rate, and revenue-
  per-appointment are trailing-90-day averages (chosen so one unusually
  good or bad week doesn't swing the forecast — change the window in
  `getForecastInputs()` if 90 days doesn't fit the business's actual sales
  cycle).
- Remaining selling days excludes Sundays (`remainingSellingDaysInMonth()`).
- Every one of these numbers is displayed on the Forecast page under
  "Assumptions used" — nothing here is a hidden constant.

## Alert catalog

Implemented in `generate_alerts()` (see `supabase/migrations/
0005_alerts_function.sql`):

1. Lead not contacted within 5 minutes
2. Lead has no next (pending) follow-up task
3. Appointment unconfirmed and upcoming
4. Deal sold but no deposit collected
5. Outstanding balance overdue (job completed 7+ days ago, still unpaid)
6. Failed payment attempt with no successful retry
7. Lead attribution missing
8. Salesperson below daily dial target (checked for the prior day)

Not yet implemented (same detect-condition → upsert-alert pattern —
straightforward to add once there's real usage data to tune thresholds
against): lead has no assigned owner, appointment no-showed follow-up
missing, low contact/booking/close rate, CRM data stale, integration
failed, revenue suddenly drops, refund/cancellation rate increases.
