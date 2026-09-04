import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateRange } from "./date-ranges";
import type { TaskDueRange } from "./task-due-filters";
import { closeRate } from "./kpi";
import type {
  Alert,
  FinancialPeriodType,
  FinancialSnapshotRow,
  FollowUpStatus,
  FollowUpTask,
  FunnelSummaryRow,
  Goal,
  Lead,
  Opportunity,
} from "@/types/database";

/**
 * Data-access layer. Every function here takes an already-authenticated
 * Supabase client (see src/lib/supabase/server.ts) and relies on Postgres
 * Row Level Security to scope rows to what the caller's role is allowed to
 * see (owner vs. sales_associate — supabase/migrations/0002_rls.sql). This
 * file does NOT re-implement role filtering; it only applies date-range
 * filters, so a sales_associate calling the exact same function as the
 * owner correctly gets only their own rows back.
 *
 * All `_cents` fields are integers. Never do money math in floating point
 * outside of the final /100 display conversion in src/lib/kpi.ts.
 */

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumRange<T extends Record<string, unknown>>(
  rows: T[],
  range: DateRange,
  dayField: keyof T,
  valueField: keyof T
): number {
  const startDay = toISODate(range.start);
  const endDay = toISODate(range.end);
  return rows
    .filter((r) => {
      const day = String(r[dayField]);
      return day >= startDay && day <= endDay;
    })
    .reduce((sum, r) => sum + (Number(r[valueField]) || 0), 0);
}

export interface RawKpiInputs {
  newLeads: number;
  totalDials: number;
  connectedCalls: number;
  meaningfulConversations: number; // connected calls with duration >= 90s, a proxy documented in kpi-dictionary.md
  appointmentsBooked: number;
  appointmentsShowed: number;
  dealsClosed: number;
  revenueSoldCents: number;
  cashCollectedCents: number;
  depositsCollectedCents: number;
  outstandingBalanceCents: number;
  fastestContactMinutes: number | null;
}

/**
 * Pulls every raw number the executive KPI cards need for one date range.
 * Called twice by the dashboard page (current range + previous comparable
 * range) to compute %-change.
 */
export async function getRawKpiInputs(
  supabase: SupabaseClient,
  range: DateRange
): Promise<RawKpiInputs> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  const [
    { count: newLeads },
    { data: dialsRows },
    { data: connectedRows },
    { data: appts },
    { data: soldDaily },
    { data: cashDaily },
    { data: outstandingOpps },
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", startISO).lte("created_at", endISO),
    supabase.from("activities").select("id").eq("type", "dial").gte("occurred_at", startISO).lte("occurred_at", endISO),
    supabase.from("activities").select("id, duration_seconds").eq("type", "connected_call").gte("occurred_at", startISO).lte("occurred_at", endISO),
    supabase.from("appointments").select("id, confirmed, showed").gte("scheduled_at", startISO).lte("scheduled_at", endISO),
    supabase.from("v_revenue_sold_daily").select("day, revenue_sold_cents, deals_sold"),
    supabase.from("v_cash_collected_daily").select("day, cash_collected_cents, deposits_collected_cents"),
    supabase.from("opportunities").select("id, estimated_value_cents, stage").in("stage", ["sold", "deposit_collected"]),
  ]);

  const connected = connectedRows ?? [];
  const meaningfulConversations = connected.filter((r: any) => (r.duration_seconds ?? 0) >= 90).length;

  // "Outstanding balance" = sold-or-deposit-collected opportunities minus
  // whatever has actually been paid, summed via v_opportunity_cash. Kept as
  // a direct query (not the daily view) because it's a point-in-time
  // balance, not a daily flow.
  const oppIds = (outstandingOpps ?? []).map((o: any) => o.id);
  let outstandingBalanceCents = 0;
  if (oppIds.length > 0) {
    const { data: cashRows } = await supabase
      .from("v_opportunity_cash")
      .select("opportunity_id, cash_collected_cents")
      .in("opportunity_id", oppIds);
    const cashByOpp = new Map((cashRows ?? []).map((r: any) => [r.opportunity_id, r.cash_collected_cents]));
    outstandingBalanceCents = (outstandingOpps ?? []).reduce((sum: number, o: any) => {
      const collected = cashByOpp.get(o.id) ?? 0;
      return sum + Math.max(0, o.estimated_value_cents - collected);
    }, 0);
  }

  return {
    newLeads: newLeads ?? 0,
    totalDials: dialsRows?.length ?? 0,
    connectedCalls: connected.length,
    meaningfulConversations,
    appointmentsBooked: appts?.length ?? 0,
    appointmentsShowed: (appts ?? []).filter((a: any) => a.showed === true).length,
    dealsClosed: sumRange(soldDaily ?? [], range, "day", "deals_sold"),
    revenueSoldCents: sumRange(soldDaily ?? [], range, "day", "revenue_sold_cents"),
    cashCollectedCents: sumRange(cashDaily ?? [], range, "day", "cash_collected_cents"),
    depositsCollectedCents: sumRange(cashDaily ?? [], range, "day", "deposits_collected_cents"),
    outstandingBalanceCents,
    fastestContactMinutes: null, // computed by getSpeedToLeadMinutes() below (separate query, distinct shape)
  };
}

/** Median minutes-to-first-contact for leads created in range that have since been contacted. */
export async function getSpeedToLeadMinutes(supabase: SupabaseClient, range: DateRange): Promise<number | null> {
  const { data } = await supabase
    .from("leads")
    .select("created_at, first_contacted_at")
    .gte("created_at", range.start.toISOString())
    .lte("created_at", range.end.toISOString())
    .not("first_contacted_at", "is", null);

  if (!data || data.length === 0) return null;
  const minutes = data
    .map((l: any) => (new Date(l.first_contacted_at).getTime() - new Date(l.created_at).getTime()) / 60000)
    .sort((a, b) => a - b);
  const mid = Math.floor(minutes.length / 2);
  return minutes.length % 2 === 0 ? (minutes[mid - 1] + minutes[mid]) / 2 : minutes[mid];
}

export async function getFunnelSummary(supabase: SupabaseClient): Promise<FunnelSummaryRow[]> {
  const { data, error } = await supabase.from("v_funnel_summary").select("*");
  if (error) throw error;
  return data ?? [];
}

export interface FunnelStageRow {
  stage: string;
  currentCount: number;
  everReachedCount: number;
  avgTimeInStageHours: number | null;
  revenueAttachedCents: number;
  cashCollectedCents: number;
}

/**
 * Full top-to-bottom funnel, combining lead-stage counts (top of funnel,
 * before an opportunity/price exists) with opportunity-stage counts and
 * revenue/cash (once a deal is qualified and priced). See
 * docs/kpi-dictionary.md "Sales Funnel" for stage definitions.
 */
export async function getFullFunnel(supabase: SupabaseClient): Promise<FunnelStageRow[]> {
  const [{ data: leadStages }, { data: oppStages }, { data: everReached }, { data: avgTime }] = await Promise.all([
    supabase.from("v_lead_funnel_summary").select("*"),
    supabase.from("v_funnel_summary").select("*"),
    supabase.from("v_stage_ever_reached").select("*"),
    supabase.from("v_avg_time_in_stage").select("*"),
  ]);

  const EARLY_LEAD_STAGES = new Set(["new_lead", "attempting_contact", "contacted"]);

  const rows: FunnelStageRow[] = [];
  for (const stage of PIPELINE_STAGE_ORDER_FOR_FUNNEL) {
    const entityType = EARLY_LEAD_STAGES.has(stage) ? "lead" : "opportunity";
    const currentCount = entityType === "lead"
      ? (leadStages ?? []).find((r: any) => r.stage === stage)?.lead_count ?? 0
      : (oppStages ?? []).find((r: any) => r.stage === stage)?.opportunity_count ?? 0;
    const everReachedCount = (everReached ?? []).find((r: any) => r.entity_type === entityType && r.stage === stage)?.ever_reached_count ?? 0;
    const avgRow = (avgTime ?? []).find((r: any) => r.entity_type === entityType && r.stage === stage);
    const opp = (oppStages ?? []).find((r: any) => r.stage === stage);

    rows.push({
      stage,
      currentCount,
      everReachedCount,
      avgTimeInStageHours: avgRow ? parseDurationToHours(avgRow.avg_duration) : null,
      revenueAttachedCents: opp?.revenue_attached_cents ?? 0,
      cashCollectedCents: opp?.cash_collected_cents ?? 0,
    });
  }
  return rows;
}

const PIPELINE_STAGE_ORDER_FOR_FUNNEL = [
  "new_lead", "attempting_contact", "contacted", "qualified", "appointment_booked",
  "appointment_confirmed", "showed", "sold", "deposit_collected", "paid_in_full",
  "job_completed", "review_requested",
];

/** Postgres interval comes back from supabase-js as a string like "12:34:56" or "3 days 04:00:00". */
function parseDurationToHours(pgInterval: string | null): number | null {
  if (!pgInterval) return null;
  let totalHours = 0;
  const dayMatch = pgInterval.match(/(\d+)\s+days?/);
  if (dayMatch) totalHours += parseInt(dayMatch[1], 10) * 24;
  const timeMatch = pgInterval.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) totalHours += parseInt(timeMatch[1], 10) + parseInt(timeMatch[2], 10) / 60;
  return totalHours;
}

export async function getGoals(supabase: SupabaseClient): Promise<Goal[]> {
  // Most-recent effective row per metric_key/scope/period — owner-only
  // table, RLS returns nothing for a sales_associate caller.
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("effective_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function findGoal(goals: Goal[], metricKey: string, period: Goal["period"], scope: Goal["scope"] = "company"): number | null {
  const match = goals.find((g) => g.metric_key === metricKey && g.period === period && g.scope === scope);
  return match ? match.target_value : null;
}

export async function getOpenAlerts(supabase: SupabaseClient): Promise<Alert[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("status", "open")
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Opportunities for the Kanban/table pipeline view. RLS scopes this to "my deals" for a sales_associate automatically. */
export interface RevenueBreakdown {
  revenueSoldCents: number;
  cashCollectedCents: number;
  depositsCollectedCents: number;
  refundedCents: number;
  completedJobRevenueCents: number;
  byService: { label: string; revenueSoldCents: number }[];
  bySalesperson: { label: string; revenueSoldCents: number }[];
  bySource: { label: string; revenueSoldCents: number; cashCollectedCents: number }[];
}

/**
 * Full revenue/cash breakdown for one date range. Deliberately fetches
 * revenue sold, cash collected, deposits, refunds, and completed-job
 * revenue as five SEPARATE numbers — never combine them (see
 * docs/kpi-dictionary.md "The six numbers that must never be merged").
 */
export async function getRevenueBreakdown(supabase: SupabaseClient, range: DateRange): Promise<RevenueBreakdown> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  const [{ data: soldDaily }, { data: cashDaily }, { data: completedDaily }, { data: soldTransitions }] = await Promise.all([
    supabase.from("v_revenue_sold_daily").select("day, revenue_sold_cents"),
    supabase.from("v_cash_collected_daily").select("day, cash_collected_cents, deposits_collected_cents, refunded_cents"),
    supabase.from("v_completed_job_revenue_daily").select("day, completed_job_revenue_cents"),
    supabase
      .from("stage_history")
      .select("entity_id, changed_at")
      .eq("entity_type", "opportunity")
      .eq("to_stage", "sold")
      .gte("changed_at", startISO)
      .lte("changed_at", endISO),
  ]);

  const oppIds = (soldTransitions ?? []).map((t: any) => t.entity_id);
  let byService: RevenueBreakdown["byService"] = [];
  let bySalesperson: RevenueBreakdown["bySalesperson"] = [];
  let bySource: RevenueBreakdown["bySource"] = [];

  if (oppIds.length > 0) {
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, estimated_value_cents, service_id, salesperson_id, lead_id, services(name), profiles(full_name)")
      .in("id", oppIds);

    const serviceTotals = new Map<string, number>();
    const salespersonTotals = new Map<string, number>();
    const leadIds: string[] = [];

    for (const o of opps ?? []) {
      const serviceName = (o as any).services?.name ?? "Unspecified";
      serviceTotals.set(serviceName, (serviceTotals.get(serviceName) ?? 0) + o.estimated_value_cents);
      const spName = (o as any).profiles?.full_name ?? "Unassigned";
      salespersonTotals.set(spName, (salespersonTotals.get(spName) ?? 0) + o.estimated_value_cents);
      if (o.lead_id) leadIds.push(o.lead_id);
    }
    byService = Array.from(serviceTotals, ([label, revenueSoldCents]) => ({ label, revenueSoldCents }));
    bySalesperson = Array.from(salespersonTotals, ([label, revenueSoldCents]) => ({ label, revenueSoldCents }));
  }

  const { data: bySourceRows } = await supabase
    .from("v_opportunity_daily_by_source")
    .select("day, source_name, revenue_sold_cents, cash_collected_cents");
  const sourceTotals = new Map<string, { revenueSoldCents: number; cashCollectedCents: number }>();
  for (const r of bySourceRows ?? []) {
    const day = String(r.day);
    if (day < range.start.toISOString().slice(0, 10) || day > range.end.toISOString().slice(0, 10)) continue;
    const label = r.source_name ?? "Unknown";
    const existing = sourceTotals.get(label) ?? { revenueSoldCents: 0, cashCollectedCents: 0 };
    existing.revenueSoldCents += r.revenue_sold_cents;
    existing.cashCollectedCents += r.cash_collected_cents;
    sourceTotals.set(label, existing);
  }
  bySource = Array.from(sourceTotals, ([label, v]) => ({ label, ...v }));

  return {
    revenueSoldCents: sumRange(soldDaily ?? [], range, "day", "revenue_sold_cents"),
    cashCollectedCents: sumRange(cashDaily ?? [], range, "day", "cash_collected_cents"),
    depositsCollectedCents: sumRange(cashDaily ?? [], range, "day", "deposits_collected_cents"),
    refundedCents: sumRange(cashDaily ?? [], range, "day", "refunded_cents"),
    completedJobRevenueCents: sumRange(completedDaily ?? [], range, "day", "completed_job_revenue_cents"),
    byService,
    bySalesperson,
    bySource,
  };
}

export interface ScorecardRow {
  profileId: string;
  fullName: string;
  dials: number;
  connectedCalls: number;
  texts: number;
  emails: number;
  appointmentsBooked: number;
  appointmentsShowed: number;
  dealsClosed: number;
  revenueSoldCents: number;
  cashCollectedCents: number;
  followUpsCompleted: number;
  followUpsTotal: number;
}

/**
 * Per-salesperson scorecard for one date range. Combine with
 * src/lib/kpi.ts's weightedScorecardScore() + the scorecard_weights table
 * to produce the ranked leaderboard — deliberately NOT ranked by revenue
 * alone (see docs/kpi-dictionary.md).
 */
export async function getScorecards(supabase: SupabaseClient, range: DateRange): Promise<ScorecardRow[]> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const startDay = toISODate(range.start);
  const endDay = toISODate(range.end);

  const [{ data: profiles }, { data: activityDaily }, { data: appts }, { data: soldTransitions }, { data: followUps }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase.from("v_activity_daily").select("*"),
    supabase.from("appointments").select("opportunity_id, confirmed, showed, opportunities(salesperson_id)").gte("scheduled_at", startISO).lte("scheduled_at", endISO),
    supabase.from("stage_history").select("entity_id").eq("entity_type", "opportunity").eq("to_stage", "sold").gte("changed_at", startISO).lte("changed_at", endISO),
    supabase.from("follow_up_tasks").select("assigned_to, status").gte("due_at", startISO).lte("due_at", endISO),
  ]);

  const soldOppIds = (soldTransitions ?? []).map((t: any) => t.entity_id);
  let soldOpps: any[] = [];
  if (soldOppIds.length > 0) {
    const { data } = await supabase.from("opportunities").select("id, estimated_value_cents, salesperson_id").in("id", soldOppIds);
    soldOpps = data ?? [];
  }
  const cashByOpp = new Map<string, number>();
  if (soldOppIds.length > 0) {
    const { data: cashRows } = await supabase.from("v_opportunity_cash").select("opportunity_id, cash_collected_cents").in("opportunity_id", soldOppIds);
    for (const r of cashRows ?? []) cashByOpp.set(r.opportunity_id, r.cash_collected_cents);
  }

  return (profiles ?? []).map((p: any) => {
    const myActivity = (activityDaily ?? []).filter((a: any) => a.performed_by === p.id && a.day >= startDay && a.day <= endDay);
    const myAppts = (appts ?? []).filter((a: any) => a.opportunities?.salesperson_id === p.id);
    const mySold = soldOpps.filter((o) => o.salesperson_id === p.id);
    const myFollowUps = (followUps ?? []).filter((f: any) => f.assigned_to === p.id);

    return {
      profileId: p.id,
      fullName: p.full_name,
      dials: myActivity.reduce((s: number, a: any) => s + a.dials, 0),
      connectedCalls: myActivity.reduce((s: number, a: any) => s + a.connected_calls, 0),
      texts: myActivity.reduce((s: number, a: any) => s + a.texts, 0),
      emails: myActivity.reduce((s: number, a: any) => s + a.emails, 0),
      appointmentsBooked: myAppts.length,
      appointmentsShowed: myAppts.filter((a: any) => a.showed === true).length,
      dealsClosed: mySold.length,
      revenueSoldCents: mySold.reduce((s, o) => s + o.estimated_value_cents, 0),
      cashCollectedCents: mySold.reduce((s, o) => s + (cashByOpp.get(o.id) ?? 0), 0),
      followUpsCompleted: myFollowUps.filter((f: any) => f.status === "completed").length,
      followUpsTotal: myFollowUps.length,
    };
  });
}

export async function getScorecardWeights(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("scorecard_weights").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export interface ActionItem {
  id: string;
  name: string;
  phone: string | null;
  opportunityValueCents: number | null;
  assignedTo: string | null;
  stage: string;
  lastContact: string | null;
  nextTask: string | null;
}

export interface DailyCommandCenterData {
  uncontactedNewLeads: ActionItem[];
  leadsWaitingOver5Min: ActionItem[];
  leadsWithNoNextTask: ActionItem[];
  appointmentsToday: ActionItem[];
  unconfirmedAppointments: ActionItem[];
  depositsNotCollected: ActionItem[];
  outstandingBalances: ActionItem[];
}

/**
 * Everything the owner/associate needs to act on TODAY. Several of these
 * conditions mirror generate_alerts() (0005_alerts_function.sql) — the
 * alerts table is the durable, assignable/dismissable record of these
 * issues, while this query is the live, always-current working list for
 * the command center page itself. They're expected to roughly agree; if
 * they diverge for more than a few minutes, the alert-generation cron
 * (docs/deployment-guide.md) probably isn't running.
 */
export async function getDailyCommandCenter(supabase: SupabaseClient): Promise<DailyCommandCenterData> {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const [{ data: newLeads }, { data: noTaskLeads }, { data: apptsToday }, { data: unconfirmed }, { data: soldNoDeposit }] = await Promise.all([
    supabase.from("leads").select("id, first_name, last_name, phone, assigned_to, stage, last_contacted_at, created_at")
      .in("stage", ["new_lead", "attempting_contact"]).is("first_contacted_at", null).order("created_at", { ascending: true }),
    supabase.from("leads").select("id, first_name, last_name, phone, assigned_to, stage, last_contacted_at")
      .not("stage", "in", '("lost","job_completed","review_requested")'),
    supabase.from("appointments").select("id, scheduled_at, confirmed, opportunity_id, opportunities(id, estimated_value_cents, salesperson_id, lead_id, leads(first_name,last_name,phone))")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString()),
    supabase.from("appointments").select("id, scheduled_at, confirmed, opportunity_id, opportunities(id, estimated_value_cents, salesperson_id, lead_id, leads(first_name,last_name,phone))")
      .eq("confirmed", false).gte("scheduled_at", now.toISOString()),
    supabase.from("opportunities").select("id, estimated_value_cents, salesperson_id, lead_id, stage, leads(first_name,last_name,phone)").eq("stage", "sold"),
  ]);

  // "no next task" needs an anti-join against follow_up_tasks — done in JS
  // since supabase-js doesn't express NOT EXISTS joins directly.
  const candidateLeadIds = (noTaskLeads ?? []).map((l: any) => l.id);
  let leadsWithPendingTask = new Set<string>();
  if (candidateLeadIds.length > 0) {
    const { data: pending } = await supabase.from("follow_up_tasks").select("lead_id").eq("status", "pending").in("lead_id", candidateLeadIds);
    leadsWithPendingTask = new Set((pending ?? []).map((t: any) => t.lead_id));
  }

  const toItem = (l: any): ActionItem => ({
    id: l.id,
    name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed lead",
    phone: l.phone,
    opportunityValueCents: null,
    assignedTo: l.assigned_to,
    stage: l.stage,
    lastContact: l.last_contacted_at,
    nextTask: null,
  });

  const apptToItem = (a: any): ActionItem => {
    const lead = a.opportunities?.leads;
    return {
      id: a.id,
      name: lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() : "Unknown",
      phone: lead?.phone ?? null,
      opportunityValueCents: a.opportunities?.estimated_value_cents ?? null,
      assignedTo: a.opportunities?.salesperson_id ?? null,
      stage: "appointment",
      lastContact: null,
      nextTask: `Appointment at ${new Date(a.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    };
  };

  const soldToItem = (o: any): ActionItem => ({
    id: o.id,
    name: o.leads ? `${o.leads.first_name ?? ""} ${o.leads.last_name ?? ""}`.trim() : "Unknown",
    phone: o.leads?.phone ?? null,
    opportunityValueCents: o.estimated_value_cents,
    assignedTo: o.salesperson_id,
    stage: o.stage,
    lastContact: null,
    nextTask: "Collect deposit",
  });

  return {
    uncontactedNewLeads: (newLeads ?? []).map(toItem),
    leadsWaitingOver5Min: (newLeads ?? [])
      .filter((l: any) => new Date(l.created_at) < new Date(fiveMinAgo))
      .map(toItem),
    leadsWithNoNextTask: (noTaskLeads ?? []).filter((l: any) => !leadsWithPendingTask.has(l.id)).map(toItem),
    appointmentsToday: (apptsToday ?? []).map(apptToItem),
    unconfirmedAppointments: (unconfirmed ?? []).map(apptToItem),
    depositsNotCollected: (soldNoDeposit ?? []).map(soldToItem),
    outstandingBalances: [], // surfaced via the balance_overdue alert type instead (see Alerts page) — avoids computing the same "outstanding" logic twice with slightly different edges
  };
}

export interface LeadSourceReportRow {
  sourceName: string;
  leads: number;
  missingAttributionCount: number;
  appointmentsBooked: number;
  appointmentsShowed: number;
  dealsClosed: number;
  revenueSoldCents: number;
  cashCollectedCents: number;
  adSpendCents: number;
}

const PLATFORM_TO_SOURCE_NAME: Record<string, string> = {
  meta: "Facebook & Instagram Ads",
  google: "Google Ads",
};

/**
 * Lead-source performance for one date range, joining CRM lead/opportunity
 * data against ad platform spend. Ad spend is matched to a lead source by
 * PLATFORM_TO_SOURCE_NAME — extend that map (and lead_sources) together
 * when a new ad platform is added.
 */
export async function getLeadSourceReport(supabase: SupabaseClient, range: DateRange): Promise<LeadSourceReportRow[]> {
  const startDay = toISODate(range.start);
  const endDay = toISODate(range.end);

  const [{ data: leadsBySource }, { data: oppsBySource }, { data: adSpend }, { data: allAppts }] = await Promise.all([
    supabase.from("v_leads_daily_by_source").select("*"),
    supabase.from("v_opportunity_daily_by_source").select("*"),
    supabase.from("ad_spend").select("platform, spend_date, spend_cents").gte("spend_date", startDay).lte("spend_date", endDay),
    supabase.from("appointments").select("confirmed, showed, opportunity_id, opportunities(lead_id, leads(lead_source_id, lead_sources(name)))").gte("scheduled_at", range.start.toISOString()).lte("scheduled_at", range.end.toISOString()),
  ]);

  const inRange = (day: string) => day >= startDay && day <= endDay;

  const bySourceName = new Map<string, LeadSourceReportRow>();
  const ensure = (name: string) => {
    if (!bySourceName.has(name)) {
      bySourceName.set(name, { sourceName: name, leads: 0, missingAttributionCount: 0, appointmentsBooked: 0, appointmentsShowed: 0, dealsClosed: 0, revenueSoldCents: 0, cashCollectedCents: 0, adSpendCents: 0 });
    }
    return bySourceName.get(name)!;
  };

  for (const r of leadsBySource ?? []) {
    if (!inRange(String(r.day))) continue;
    const row = ensure(r.source_name ?? "Unknown");
    row.leads += r.leads;
    row.missingAttributionCount += r.missing_attribution_count;
  }
  for (const r of oppsBySource ?? []) {
    if (!inRange(String(r.day))) continue;
    const row = ensure(r.source_name ?? "Unknown");
    row.dealsClosed += r.deals_sold;
    row.revenueSoldCents += r.revenue_sold_cents;
    row.cashCollectedCents += r.cash_collected_cents;
  }
  for (const a of allAppts ?? []) {
    const sourceName = (a as any).opportunities?.leads?.lead_sources?.name ?? "Unknown";
    const row = ensure(sourceName);
    row.appointmentsBooked += 1;
    if ((a as any).showed === true) row.appointmentsShowed += 1;
  }
  for (const s of adSpend ?? []) {
    const name = PLATFORM_TO_SOURCE_NAME[s.platform] ?? s.platform;
    const row = ensure(name);
    row.adSpendCents += s.spend_cents;
  }

  return Array.from(bySourceName.values());
}

export interface CallRow {
  id: string;
  leadName: string;
  direction: string;
  outcome: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  occurredAt: string;
  performedBy: string | null;
  cqOverallScore: number | null;
}

export async function getCallActivity(supabase: SupabaseClient, range: DateRange): Promise<CallRow[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("id, direction, outcome, duration_seconds, recording_url, occurred_at, performed_by, cq_overall_score, leads(first_name,last_name)")
    .in("type", ["dial", "connected_call"])
    .gte("occurred_at", range.start.toISOString())
    .lte("occurred_at", range.end.toISOString())
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    leadName: a.leads ? `${a.leads.first_name ?? ""} ${a.leads.last_name ?? ""}`.trim() || "Unknown" : "Unknown",
    direction: a.direction,
    outcome: a.outcome,
    durationSeconds: a.duration_seconds,
    recordingUrl: a.recording_url,
    occurredAt: a.occurred_at,
    performedBy: a.performed_by,
    cqOverallScore: a.cq_overall_score,
  }));
}

export interface ForecastQueryData {
  revenueSoldSoFarThisMonthCents: number;
  openPipelineValueCents: number;
  historicalCloseRatePct: number;
  historicalAvgTicketCents: number;
  historicalLeadToDealRatePct: number;
  historicalRevenuePerAppointmentCents: number;
}

/**
 * Historical rates are computed from a trailing 90-day window so a single
 * slow week doesn't wildly swing the forecast — see
 * docs/kpi-dictionary.md "Forecasting assumptions" for why 90 days.
 */
export async function getForecastInputs(supabase: SupabaseClient, monthRange: DateRange): Promise<ForecastQueryData> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [{ data: soldThisMonth }, { data: openOpps }, { data: historicalSoldTransitions }, { count: historicalLeadsCount }, { data: historicalAppts }] = await Promise.all([
    supabase.from("v_revenue_sold_daily").select("day, revenue_sold_cents"),
    supabase.from("opportunities").select("estimated_value_cents").in("stage", ["qualified", "appointment_booked", "appointment_confirmed", "showed"]),
    supabase.from("stage_history").select("entity_id").eq("entity_type", "opportunity").eq("to_stage", "sold").gte("changed_at", ninetyDaysAgo.toISOString()),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", ninetyDaysAgo.toISOString()),
    supabase.from("appointments").select("showed").gte("scheduled_at", ninetyDaysAgo.toISOString()),
  ]);

  const revenueSoldSoFarThisMonthCents = sumRange(soldThisMonth ?? [], monthRange, "day", "revenue_sold_cents");
  const openPipelineValueCents = (openOpps ?? []).reduce((sum: number, o: any) => sum + o.estimated_value_cents, 0);

  const soldOppIds = (historicalSoldTransitions ?? []).map((t: any) => t.entity_id);
  let historicalAvgTicketCents = 0;
  if (soldOppIds.length > 0) {
    const { data: soldOpps } = await supabase.from("opportunities").select("estimated_value_cents").in("id", soldOppIds);
    const total = (soldOpps ?? []).reduce((s, o) => s + o.estimated_value_cents, 0);
    historicalAvgTicketCents = total / soldOppIds.length;
  }

  const showedCount = (historicalAppts ?? []).filter((a: any) => a.showed === true).length;
  const historicalCloseRatePct = closeRate(soldOppIds.length, showedCount || soldOppIds.length || 1);
  const historicalLeadToDealRatePct = historicalLeadsCount ? (soldOppIds.length / historicalLeadsCount) * 100 : 0;
  const historicalRevenuePerAppointmentCents = (historicalAppts?.length ?? 0) > 0
    ? (historicalAvgTicketCents * soldOppIds.length) / (historicalAppts?.length ?? 1)
    : 0;

  return {
    revenueSoldSoFarThisMonthCents,
    openPipelineValueCents,
    historicalCloseRatePct,
    historicalAvgTicketCents,
    historicalLeadToDealRatePct,
    historicalRevenuePerAppointmentCents,
  };
}

export async function getPipelineOpportunities(supabase: SupabaseClient): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface LeadListRow extends Lead {
  source_name: string | null;
}

/**
 * Every lead (not just ones that have become a priced opportunity yet) —
 * this is the actual CRM inbox view: everything GoHighLevel (or any other
 * source) has sent in, with its current stage + hot/warm/cold temperature.
 * RLS already scopes this to "my leads only" for a sales_associate; no
 * extra filtering needed here (see the file header note on RLS).
 */
export async function getLeadsList(supabase: SupabaseClient): Promise<LeadListRow[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("*, lead_sources(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    source_name: row.lead_sources?.name ?? null,
  }));
}

export interface FollowUpTaskRow extends FollowUpTask {
  lead_name: string;
  lead_phone: string | null;
  lead_email: string | null;
  lead_vehicle: string | null;
  lead_requested_booking_timeframe: string | null;
  lead_first_contacted_at: string | null;
  lead_ai_notes: string | null;
  lead_ai_notes_updated_at: string | null;
  lead_stage: string;
  lead_temperature: string;
}

export type FollowUpTaskFilter = FollowUpStatus | "all";

/**
 * Call-back tasks for the Tasks page. Most of these rows are generated
 * automatically by triggers on the leads table (supabase/migrations/0011);
 * some are typed in by hand (cadence_rule = 'manual', supabase/migrations/0015
 * - see `note`/`created_by`). RLS (followup_assoc_select / followup_owner_all,
 * 0002_rls.sql) already scopes this to "my tasks" for a sales_associate and
 * "everyone's tasks" for the owner - no extra filtering needed.
 *
 * Pulls everything the click-to-expand customer profile on the Tasks page
 * needs. Vehicle and requested-booking-timeframe are plain columns on
 * `leads` (supabase/migrations/0012); ai_notes/ai_notes_updated_at come from
 * the call-summary sync (supabase/migrations/0013,
 * src/lib/integrations/call-summaries.ts) and stay null until that's run.
 *
 * `statusFilter` defaults to "pending" (the working view everyone lands on).
 * Pass "all" to see every status, or one of "completed"/"skipped"/"canceled"
 * to browse history. `dueRange` is the Tasks page's due-date filter
 * (src/lib/task-due-filters.ts) - pass undefined/omit for no filter. Either
 * side of the range can be null for an open-ended bound (e.g. "Overdue" has
 * no start, just an end of "today"). Pending tasks sort soonest-due-first
 * (what needs doing next); anything else sorts most-recently-due-first
 * (a history view reads better newest-first).
 */
export async function getFollowUpTasks(
  supabase: SupabaseClient,
  options?: { statusFilter?: FollowUpTaskFilter; dueRange?: TaskDueRange }
): Promise<FollowUpTaskRow[]> {
  const statusFilter = options?.statusFilter ?? "pending";
  const dueRange = options?.dueRange;

  let query = supabase
    .from("follow_up_tasks")
    .select(
      "*, leads(first_name, last_name, phone, email, vehicle, requested_booking_timeframe, first_contacted_at, ai_notes, ai_notes_updated_at, stage, temperature)"
    );

  if (statusFilter !== "all") query = query.eq("status", statusFilter);
  if (dueRange?.start) query = query.gte("due_at", dueRange.start.toISOString());
  if (dueRange?.end) query = query.lt("due_at", dueRange.end.toISOString());

  const { data, error } = await query.order("due_at", { ascending: statusFilter === "pending" });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    lead_name: `${row.leads?.first_name ?? ""} ${row.leads?.last_name ?? ""}`.trim() || "Unnamed lead",
    lead_phone: row.leads?.phone ?? null,
    lead_email: row.leads?.email ?? null,
    lead_vehicle: row.leads?.vehicle ?? null,
    lead_requested_booking_timeframe: row.leads?.requested_booking_timeframe ?? null,
    lead_first_contacted_at: row.leads?.first_contacted_at ?? null,
    lead_ai_notes: row.leads?.ai_notes ?? null,
    lead_ai_notes_updated_at: row.leads?.ai_notes_updated_at ?? null,
    lead_stage: row.leads?.stage ?? "new_lead",
    lead_temperature: row.leads?.temperature ?? "unset",
  }));
}

export interface TaskPickerLead {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Lightweight lead list for the "add your own task" picker on the Tasks
 * page - just enough to search by name and confirm you picked the right
 * person, not the full LeadListRow used on the Leads page. RLS scopes this
 * to "my leads" for a sales_associate the same as everywhere else.
 */
export async function getLeadsForTaskPicker(supabase: SupabaseClient): Promise<TaskPickerLead[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, first_name, last_name, phone")
    .order("first_name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((l: any) => ({
    id: l.id,
    name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed lead",
    phone: l.phone ?? null,
  }));
}

// --- Simple P&L (QuickBooks-sourced financial_snapshots — see migration 0016) ---

export type PnlPeriod = "current_month" | "previous_month" | "ytd";

export interface SimplePnl {
  revenueCents: number;
  suppliesCents: number;
  laborCents: number;
  marketingCents: number;
  rentCents: number;
  otherCents: number;
  totalExpensesCents: number;
  profitCents: number;
  /** null when revenue is 0 — dividing by zero isn't a meaningful margin. */
  profitMarginPct: number | null;
  syncedAt: string | null;
}

/** Must exactly match the period_label scheme quickbooks.ts's sync() writes, or lookups will silently miss. */
function pnlPeriodLabel(period: PnlPeriod, now: Date): { periodType: FinancialPeriodType; periodLabel: string } {
  if (period === "ytd") return { periodType: "ytd", periodLabel: `${now.getUTCFullYear()}` };
  const monthDate =
    period === "current_month"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    periodType: "month",
    periodLabel: `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

function toSimplePnl(row: FinancialSnapshotRow | null): SimplePnl | null {
  if (!row) return null;
  const totalExpensesCents = row.supplies_cents + row.labor_cents + row.marketing_cents + row.rent_cents + row.other_cents;
  const profitCents = row.revenue_cents - totalExpensesCents;
  return {
    revenueCents: row.revenue_cents,
    suppliesCents: row.supplies_cents,
    laborCents: row.labor_cents,
    marketingCents: row.marketing_cents,
    rentCents: row.rent_cents,
    otherCents: row.other_cents,
    totalExpensesCents,
    profitCents,
    profitMarginPct: row.revenue_cents > 0 ? (profitCents / row.revenue_cents) * 100 : null,
    syncedAt: row.synced_at,
  };
}

/** Returns null (not a zeroed-out P&L) when QuickBooks hasn't synced this period yet — the UI must tell the owner "not synced," never silently show $0. */
export async function getSimplePnl(
  supabase: SupabaseClient,
  period: PnlPeriod,
  now: Date = new Date()
): Promise<SimplePnl | null> {
  const { periodType, periodLabel } = pnlPeriodLabel(period, now);
  const { data, error } = await supabase
    .from("financial_snapshots")
    .select("*")
    .eq("source_platform", "quickbooks")
    .eq("period_type", periodType)
    .eq("period_label", periodLabel)
    .maybeSingle();
  if (error) throw error;
  return toSimplePnl((data as FinancialSnapshotRow | null) ?? null);
}
