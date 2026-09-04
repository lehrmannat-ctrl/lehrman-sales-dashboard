/**
 * KPI calculation helpers. These are pure functions operating on numbers
 * already aggregated from the database (see src/lib/queries.ts) — this file
 * has no I/O so it can be unit tested directly.
 *
 * Every formula here has a matching entry in docs/kpi-dictionary.md. If you
 * change a calculation, update both places.
 */

export type KpiStatus = "good" | "warn" | "bad" | "no_goal";

export interface KpiResult {
  key: string;
  label: string;
  /** Raw current value for the selected period (dollars, count, or %). */
  current: number;
  /** Goal for the same period, or null if no goal has been set. */
  goal: number | null;
  /** current - goal. Positive means ahead of goal. */
  differenceFromGoal: number | null;
  /** % change vs. the previous comparable period, or null if not computable. */
  percentChangeVsPrevPeriod: number | null;
  status: KpiStatus;
  format: "currency" | "count" | "percent" | "minutes";
}

/**
 * Status thresholds: within 5% short of goal (or above) is "good", within
 * 20% short is "warn", further behind is "bad". A metric with no goal set
 * is reported honestly as "no_goal" rather than guessing a color.
 */
export function statusForGoal(current: number, goal: number | null): KpiStatus {
  if (goal === null || goal === undefined || Number.isNaN(goal)) return "no_goal";
  if (goal === 0) return current > 0 ? "good" : "warn";
  const ratio = current / goal;
  if (ratio >= 0.95) return "good";
  if (ratio >= 0.8) return "warn";
  return "bad";
}

/** Null-safe percent change; returns null when the previous value was 0 or missing (division by zero is undefined, not "infinite growth"). */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function buildKpiResult(params: {
  key: string;
  label: string;
  current: number;
  goal: number | null;
  previousPeriodValue: number | null;
  format: KpiResult["format"];
}): KpiResult {
  const { key, label, current, goal, previousPeriodValue, format } = params;
  return {
    key,
    label,
    current,
    goal,
    differenceFromGoal: goal === null ? null : current - goal,
    percentChangeVsPrevPeriod: percentChange(current, previousPeriodValue),
    status: statusForGoal(current, goal),
    format,
  };
}

// --- Derived-rate formulas (all guard against divide-by-zero) ---

export function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

/** Contacted / New Leads */
export function contactRate(contacted: number, newLeads: number): number {
  return safeRate(contacted, newLeads) * 100;
}

/** Appointments Showed / Appointments Booked */
export function showRate(showed: number, booked: number): number {
  return safeRate(showed, booked) * 100;
}

/** Deals Closed / Appointments Showed (closers only see showed opportunities as their denominator) */
export function closeRate(dealsClosed: number, appointmentsShowed: number): number {
  return safeRate(dealsClosed, appointmentsShowed) * 100;
}

/** Revenue Sold / Deals Closed */
export function averageTicket(revenueSoldCents: number, dealsClosed: number): number {
  return safeRate(revenueSoldCents, dealsClosed);
}

export function revenuePerLead(revenueSoldCents: number, leads: number): number {
  return safeRate(revenueSoldCents, leads);
}

export function cashPerLead(cashCollectedCents: number, leads: number): number {
  return safeRate(cashCollectedCents, leads);
}

export function revenuePerAppointment(revenueSoldCents: number, appointments: number): number {
  return safeRate(revenueSoldCents, appointments);
}

export function cashPerAppointment(cashCollectedCents: number, appointments: number): number {
  return safeRate(cashCollectedCents, appointments);
}

/** Customer acquisition cost = ad spend / deals sold attributed to that spend. */
export function customerAcquisitionCost(spendCents: number, dealsClosed: number): number {
  return safeRate(spendCents, dealsClosed);
}

/** Return on ad spend, as a multiple (e.g. 4.2 = "4.2x"). */
export function returnOnAdSpend(revenueSoldCents: number, spendCents: number): number {
  return safeRate(revenueSoldCents, spendCents);
}

export function cashReturnOnAdSpend(cashCollectedCents: number, spendCents: number): number {
  return safeRate(cashCollectedCents, spendCents);
}

// --- Weighted scorecard score ---

export interface ScorecardWeights {
  cash_collected_weight: number;
  close_rate_weight: number;
  avg_ticket_weight: number;
  follow_up_completion_weight: number;
  show_rate_weight: number;
  activity_target_weight: number;
  crm_data_accuracy_weight: number;
}

export interface ScorecardInputs {
  /** Each of these should already be normalized 0-100 against its own goal (100 = hit or beat goal, capped at 100). */
  cashCollectedPctOfGoal: number;
  closeRatePctOfGoal: number;
  avgTicketPctOfGoal: number;
  followUpCompletionPctOfGoal: number;
  showRatePctOfGoal: number;
  activityPctOfGoal: number;
  crmDataAccuracyPct: number;
}

/** Weighted 0-100 score. Never rank purely on revenue — see docs/kpi-dictionary.md. */
export function weightedScorecardScore(inputs: ScorecardInputs, weights: ScorecardWeights): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    clamp(inputs.cashCollectedPctOfGoal) * weights.cash_collected_weight +
    clamp(inputs.closeRatePctOfGoal) * weights.close_rate_weight +
    clamp(inputs.avgTicketPctOfGoal) * weights.avg_ticket_weight +
    clamp(inputs.followUpCompletionPctOfGoal) * weights.follow_up_completion_weight +
    clamp(inputs.showRatePctOfGoal) * weights.show_rate_weight +
    clamp(inputs.activityPctOfGoal) * weights.activity_target_weight +
    clamp(inputs.crmDataAccuracyPct) * weights.crm_data_accuracy_weight
  );
}

// --- Forecasting ---

export interface ForecastInputs {
  revenueSoldSoFarThisMonthCents: number;
  openPipelineValueCents: number;
  historicalCloseRatePct: number; // 0-100, from a trailing window (e.g. last 90 days)
  historicalAvgTicketCents: number;
  historicalLeadToDealRatePct: number; // 0-100
  historicalRevenuePerAppointmentCents: number;
  remainingSellingDays: number; // Sundays already excluded by the caller
  monthlyRevenueGoalCents: number | null;
}

export interface ForecastResult {
  conservativeCents: number;
  expectedCents: number;
  aggressiveCents: number;
  gapToTargetCents: number | null;
  revenueNeededPerRemainingDayCents: number | null;
  appointmentsNeeded: number | null;
  dealsNeeded: number | null;
  leadsNeeded: number | null;
}

/**
 * All assumptions are parameters, not constants, so the owner can see and
 * override every one (docs/kpi-dictionary.md "Forecasting assumptions").
 */
export function computeForecast(inputs: ForecastInputs): ForecastResult {
  const closeRateFrac = inputs.historicalCloseRatePct / 100;
  const conservativeCents = inputs.revenueSoldSoFarThisMonthCents;
  const expectedCents = inputs.revenueSoldSoFarThisMonthCents + inputs.openPipelineValueCents * closeRateFrac;
  const aggressiveCents = inputs.revenueSoldSoFarThisMonthCents + inputs.openPipelineValueCents * Math.min(1, closeRateFrac * 1.5);

  const gapToTargetCents = inputs.monthlyRevenueGoalCents === null ? null : Math.max(0, inputs.monthlyRevenueGoalCents - expectedCents);

  const revenueNeededPerRemainingDayCents =
    gapToTargetCents === null || inputs.remainingSellingDays <= 0 ? null : gapToTargetCents / inputs.remainingSellingDays;

  const appointmentsNeeded =
    gapToTargetCents === null || !inputs.historicalRevenuePerAppointmentCents
      ? null
      : gapToTargetCents / inputs.historicalRevenuePerAppointmentCents;

  const dealsNeeded =
    gapToTargetCents === null || !inputs.historicalAvgTicketCents ? null : gapToTargetCents / inputs.historicalAvgTicketCents;

  const leadsNeeded =
    dealsNeeded === null || !inputs.historicalLeadToDealRatePct
      ? null
      : dealsNeeded / (inputs.historicalLeadToDealRatePct / 100);

  return {
    conservativeCents,
    expectedCents,
    aggressiveCents,
    gapToTargetCents,
    revenueNeededPerRemainingDayCents,
    appointmentsNeeded,
    dealsNeeded,
    leadsNeeded,
  };
}

/** Counts remaining calendar days in the current month from `from` (inclusive) to month end, excluding Sundays. */
export function remainingSellingDaysInMonth(from: Date): number {
  const end = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    if (cursor.getDay() !== 0) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// --- Formatting ---

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}
