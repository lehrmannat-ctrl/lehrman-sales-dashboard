import type { UserRole } from "@/types/database";

/**
 * Central role/permission matrix. See docs/role-permission-matrix.md for
 * the human-readable version of this same table — keep them in sync.
 *
 * Every page and every server action must check permissions here BEFORE
 * touching data. Row Level Security (0002_rls.sql) is the enforcement
 * backstop if this layer is ever bypassed or has a bug — the two are meant
 * to independently agree, never to be "the same check done twice for
 * looks."
 */
export type Capability =
  | "view_company_revenue"
  | "view_company_cash_collected"
  | "view_ad_spend"
  | "view_all_salespeople_performance"
  | "view_own_scorecard_only"
  | "view_pipeline_all"
  | "view_pipeline_own"
  | "view_lead_sources"
  | "view_call_recordings"
  | "view_forecasts"
  | "manage_goals"
  | "manage_scorecard_weights"
  | "manage_integrations"
  | "resolve_any_alert"
  | "resolve_own_alerts";

const OWNER_CAPABILITIES: Capability[] = [
  "view_company_revenue",
  "view_company_cash_collected",
  "view_ad_spend",
  "view_all_salespeople_performance",
  "view_pipeline_all",
  "view_lead_sources",
  "view_call_recordings",
  "view_forecasts",
  "manage_goals",
  "manage_scorecard_weights",
  "manage_integrations",
  "resolve_any_alert",
];

const SALES_ASSOCIATE_CAPABILITIES: Capability[] = [
  "view_own_scorecard_only",
  "view_pipeline_own",
  "resolve_own_alerts",
];

const CAPABILITIES_BY_ROLE: Record<UserRole, Capability[]> = {
  owner: OWNER_CAPABILITIES,
  sales_associate: SALES_ASSOCIATE_CAPABILITIES,
};

export function can(role: UserRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role]?.includes(capability) ?? false;
}

export function assertCan(role: UserRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Error(`Role "${role}" does not have capability "${capability}".`);
  }
}

/** Pages a given role is allowed to navigate to, in nav order. */
export const PAGES_BY_ROLE: Record<UserRole, { href: string; label: string }[]> = {
  owner: [
    { href: "/dashboard", label: "Executive Dashboard" },
    { href: "/leads", label: "Leads" },
    { href: "/funnel", label: "Sales Funnel" },
    { href: "/revenue", label: "Revenue & Cash" },
    { href: "/scorecards", label: "Scorecard" },
    { href: "/pipeline", label: "Pipeline" },
    { href: "/daily", label: "Daily Command Center" },
    { href: "/sources", label: "Lead Sources" },
    { href: "/calls", label: "Calls" },
    { href: "/forecast", label: "Forecast" },
    { href: "/alerts", label: "Alerts" },
    { href: "/settings/goals", label: "Goals & Targets" },
    { href: "/settings/integrations", label: "Integrations" },
  ],
  sales_associate: [
    { href: "/tasks", label: "Tasks" },
    { href: "/scorecards", label: "Scorecard" },
  ],
};
