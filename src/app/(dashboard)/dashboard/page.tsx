import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDateRange, previousComparablePeriod, type DateRangePreset } from "@/lib/date-ranges";
import { getRawKpiInputs, getSpeedToLeadMinutes, getGoals, findGoal, getSimplePnl, type PnlPeriod, type SimplePnl } from "@/lib/queries";
import { buildKpiResult, contactRate, showRate, closeRate, averageTicket, revenuePerLead, cashPerLead, revenuePerAppointment, cashPerAppointment } from "@/lib/kpi";
import { KpiCard } from "@/components/KpiCard";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { PnlSection } from "./PnlSection";

export const dynamic = "force-dynamic";

export default async function ExecutiveDashboardPage({ searchParams }: { searchParams: { range?: string } }) {
  const preset = (searchParams.range as DateRangePreset) ?? "this_month";
  const range = resolveDateRange(preset);
  const prevRange = previousComparablePeriod(preset, range);

  const supabase = createSupabaseServerClient();
  const [current, previous, speedToLeadMin, goals, pnlCurrentMonth, pnlPreviousMonth, pnlYtd] = await Promise.all([
    getRawKpiInputs(supabase, range),
    getRawKpiInputs(supabase, prevRange),
    getSpeedToLeadMinutes(supabase, range),
    getGoals(supabase),
    getSimplePnl(supabase, "current_month"),
    getSimplePnl(supabase, "previous_month"),
    getSimplePnl(supabase, "ytd"),
  ]);
  const pnlByPeriod: Record<PnlPeriod, SimplePnl | null> = {
    current_month: pnlCurrentMonth,
    previous_month: pnlPreviousMonth,
    ytd: pnlYtd,
  };

  const monthlyRevenueGoal = findGoal(goals, "revenue_sold", "monthly");
  const monthlyCashGoal = findGoal(goals, "cash_collected", "monthly");
  const dailyDialGoal = findGoal(goals, "dials", "daily");
  const speedToLeadGoal = findGoal(goals, "speed_to_lead_minutes", "monthly");
  const closeRateGoal = findGoal(goals, "close_rate_pct", "monthly");
  const showRateGoal = findGoal(goals, "show_rate_pct", "monthly");
  const avgTicketGoal = findGoal(goals, "average_ticket_cents", "monthly");
  const apptGoal = findGoal(goals, "appointments_booked", "monthly");

  const contactRateCurrent = contactRate(current.connectedCalls, current.newLeads);
  const contactRatePrev = contactRate(previous.connectedCalls, previous.newLeads);
  const showRateCurrent = showRate(current.appointmentsShowed, current.appointmentsBooked);
  const showRatePrev = showRate(previous.appointmentsShowed, previous.appointmentsBooked);
  const closeRateCurrent = closeRate(current.dealsClosed, current.appointmentsShowed);
  const closeRatePrev = closeRate(previous.dealsClosed, previous.appointmentsShowed);
  const avgTicketCurrent = averageTicket(current.revenueSoldCents, current.dealsClosed);
  const avgTicketPrev = averageTicket(previous.revenueSoldCents, previous.dealsClosed);

  const kpis = [
    buildKpiResult({ key: "new_leads", label: "New Leads", current: current.newLeads, goal: null, previousPeriodValue: previous.newLeads, format: "count" }),
    buildKpiResult({ key: "total_dials", label: "Total Dials", current: current.totalDials, goal: dailyDialGoal, previousPeriodValue: previous.totalDials, format: "count" }),
    buildKpiResult({ key: "connected_calls", label: "Connected Calls", current: current.connectedCalls, goal: null, previousPeriodValue: previous.connectedCalls, format: "count" }),
    buildKpiResult({ key: "meaningful_conversations", label: "Meaningful Conversations", current: current.meaningfulConversations, goal: null, previousPeriodValue: previous.meaningfulConversations, format: "count" }),
    buildKpiResult({ key: "appointments_booked", label: "Appointments Booked", current: current.appointmentsBooked, goal: apptGoal, previousPeriodValue: previous.appointmentsBooked, format: "count" }),
    buildKpiResult({ key: "appointments_showed", label: "Appointments Showed", current: current.appointmentsShowed, goal: null, previousPeriodValue: previous.appointmentsShowed, format: "count" }),
    buildKpiResult({ key: "deals_closed", label: "Deals Closed", current: current.dealsClosed, goal: null, previousPeriodValue: previous.dealsClosed, format: "count" }),
    buildKpiResult({ key: "revenue_sold", label: "Revenue Sold", current: current.revenueSoldCents, goal: monthlyRevenueGoal, previousPeriodValue: previous.revenueSoldCents, format: "currency" }),
    buildKpiResult({ key: "cash_collected", label: "Cash Collected", current: current.cashCollectedCents, goal: monthlyCashGoal, previousPeriodValue: previous.cashCollectedCents, format: "currency" }),
    buildKpiResult({ key: "deposits_collected", label: "Deposits Collected", current: current.depositsCollectedCents, goal: null, previousPeriodValue: previous.depositsCollectedCents, format: "currency" }),
    buildKpiResult({ key: "outstanding_balance", label: "Outstanding Balance", current: current.outstandingBalanceCents, goal: null, previousPeriodValue: previous.outstandingBalanceCents, format: "currency" }),
    buildKpiResult({ key: "average_ticket", label: "Average Ticket", current: avgTicketCurrent, goal: avgTicketGoal, previousPeriodValue: avgTicketPrev, format: "currency" }),
    buildKpiResult({ key: "close_rate", label: "Close Rate", current: closeRateCurrent, goal: closeRateGoal, previousPeriodValue: closeRatePrev, format: "percent" }),
    buildKpiResult({ key: "show_rate", label: "Show Rate", current: showRateCurrent, goal: showRateGoal, previousPeriodValue: showRatePrev, format: "percent" }),
    buildKpiResult({ key: "contact_rate", label: "Contact Rate", current: contactRateCurrent, goal: 65, previousPeriodValue: contactRatePrev, format: "percent" }),
    buildKpiResult({ key: "speed_to_lead", label: "Speed to Lead", current: speedToLeadMin ?? 0, goal: speedToLeadGoal, previousPeriodValue: null, format: "minutes" }),
    buildKpiResult({ key: "revenue_per_lead", label: "Revenue per Lead", current: revenuePerLead(current.revenueSoldCents, current.newLeads), goal: null, previousPeriodValue: revenuePerLead(previous.revenueSoldCents, previous.newLeads), format: "currency" }),
    buildKpiResult({ key: "cash_per_lead", label: "Cash per Lead", current: cashPerLead(current.cashCollectedCents, current.newLeads), goal: null, previousPeriodValue: cashPerLead(previous.cashCollectedCents, previous.newLeads), format: "currency" }),
    buildKpiResult({ key: "revenue_per_appointment", label: "Revenue per Appointment", current: revenuePerAppointment(current.revenueSoldCents, current.appointmentsBooked), goal: null, previousPeriodValue: revenuePerAppointment(previous.revenueSoldCents, previous.appointmentsBooked), format: "currency" }),
    buildKpiResult({ key: "cash_per_appointment", label: "Cash per Appointment", current: cashPerAppointment(current.cashCollectedCents, current.appointmentsBooked), goal: null, previousPeriodValue: cashPerAppointment(previous.cashCollectedCents, previous.appointmentsBooked), format: "currency" }),
  ];

  const KPI_DRILLDOWN_HREF: Record<string, string> = {
    new_leads: "/pipeline?stage=new_lead",
    total_dials: "/calls",
    connected_calls: "/calls",
    appointments_booked: "/pipeline?stage=appointment_booked",
    appointments_showed: "/pipeline?stage=showed",
    deals_closed: "/pipeline?stage=sold",
    revenue_sold: "/revenue",
    cash_collected: "/revenue",
    outstanding_balance: "/revenue",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Executive Dashboard</h1>
          <p className="text-sm text-slate-400">Every number below is honest: not connected shows as not connected, nothing is combined or smoothed over.</p>
        </div>
        <DateRangeFilter current={preset} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} href={KPI_DRILLDOWN_HREF[kpi.key]} />
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Revenue Sold, Cash Collected, Deposits Collected, and Outstanding Balance are tracked separately by design — see the Revenue &amp; Cash page for the full breakdown, including refunds and completed-job revenue.
      </p>

      <PnlSection pnlByPeriod={pnlByPeriod} />
    </div>
  );
}
