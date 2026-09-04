/**
 * Hand-written types matching supabase/migrations/*.sql.
 *
 * Once a real Supabase project exists, prefer generating precise types from
 * the live schema and reconciling them with this file:
 *   npx supabase gen types typescript --project-id <id> > src/types/generated.ts
 * This hand file exists because this codebase was built without network
 * access to a Supabase project (see docs/known-limitations.md) — it should
 * be treated as a first draft, not a permanent substitute for codegen.
 */

export type UserRole = "owner" | "sales_associate";

export type PipelineStage =
  | "new_lead"
  | "attempting_contact"
  | "contacted"
  | "qualified"
  | "appointment_booked"
  | "appointment_confirmed"
  | "showed"
  | "sold"
  | "deposit_collected"
  | "paid_in_full"
  | "job_completed"
  | "review_requested"
  | "follow_up_or_next_service_due"
  | "lost";

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  "new_lead",
  "attempting_contact",
  "contacted",
  "qualified",
  "appointment_booked",
  "appointment_confirmed",
  "showed",
  "sold",
  "deposit_collected",
  "paid_in_full",
  "job_completed",
  "review_requested",
  "follow_up_or_next_service_due",
];

export type LeadTemperature = "hot" | "warm" | "cold" | "unset";
export type LeadSourceCategory =
  | "facebook_instagram_ads"
  | "google_ads"
  | "google_business_profile"
  | "organic_social"
  | "website"
  | "referral"
  | "existing_customer"
  | "dealership"
  | "fleet_commercial"
  | "walk_in"
  | "manual_entry"
  | "unknown";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  name: string;
  category: LeadSourceCategory;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  base_price_cents: number;
  active: boolean;
}

export interface Lead {
  id: string;
  external_id: string | null;
  source_platform: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  lead_source_id: string | null;
  attribution_missing: boolean;
  assigned_to: string | null;
  stage: PipelineStage;
  temperature: LeadTemperature;
  requested_booking_timeframe: string | null;
  vehicle: string | null;
  ai_notes: string | null;
  ai_notes_updated_at: string | null;
  created_at: string;
  updated_at: string;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  lost_reason: string | null;
}

export interface Opportunity {
  id: string;
  external_id: string | null;
  source_platform: string;
  lead_id: string;
  service_id: string | null;
  vehicle_description: string | null;
  estimated_value_cents: number;
  stage: PipelineStage;
  probability: number | null;
  location: string;
  salesperson_id: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
  appointment_date: string | null;
  job_date: string | null;
}

export interface Appointment {
  id: string;
  opportunity_id: string;
  scheduled_at: string;
  confirmed: boolean;
  showed: boolean | null;
  no_show_reason: string | null;
  location: string | null;
}

export type ActivityType = "dial" | "connected_call" | "text" | "email" | "note";

export interface Activity {
  id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  performed_by: string | null;
  type: ActivityType;
  direction: "outbound" | "inbound";
  outcome: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  occurred_at: string;
  cq_overall_score: number | null;
  cq_manager_feedback: string | null;
  transcript: string | null;
  ai_summary: string | null;
}

export type FollowUpStatus = "pending" | "completed" | "skipped" | "canceled";

export interface FollowUpTask {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  due_at: string;
  cadence_rule: string;
  status: FollowUpStatus;
  completed_at: string | null;
  /** Free-text description for a manually-added task (cadence_rule = "manual"). Null for automatic cadence tasks. */
  note: string | null;
  /** Who added this task by hand (supabase/migrations/0015). Null for automatic cadence tasks. */
  created_by: string | null;
}

export type PaymentType = "deposit" | "balance" | "full_payment" | "refund";
export type PaymentStatus = "succeeded" | "pending" | "failed" | "refunded";

export interface Payment {
  id: string;
  external_id: string | null;
  opportunity_id: string | null;
  amount_cents: number;
  type: PaymentType;
  status: PaymentStatus;
  processed_at: string | null;
}

export type JobStatus = "scheduled" | "in_progress" | "completed" | "canceled";

export interface Job {
  id: string;
  opportunity_id: string;
  scheduled_at: string | null;
  completed_at: string | null;
  status: JobStatus;
}

export interface Goal {
  id: string;
  metric_key: string;
  scope: "company" | "salesperson" | "service" | "location";
  scope_id: string | null;
  scope_label: string | null;
  period: "daily" | "weekly" | "monthly";
  target_value: number;
  effective_date: string;
}

export interface ScorecardWeights {
  cash_collected_weight: number;
  close_rate_weight: number;
  avg_ticket_weight: number;
  follow_up_completion_weight: number;
  show_rate_weight: number;
  activity_target_weight: number;
  crm_data_accuracy_weight: number;
}

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  message: string;
  recommended_action: string | null;
  related_lead_id: string | null;
  related_opportunity_id: string | null;
  owner_id: string | null;
  due_at: string | null;
  status: AlertStatus;
  created_at: string;
}

export type IntegrationPlatform = "gohighlevel" | "quo" | "stripe" | "urable" | "meta_ads";
export type IntegrationStatus = "not_connected" | "connected" | "error";

export interface IntegrationRow {
  id: string;
  platform: IntegrationPlatform;
  status: IntegrationStatus;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  records_synced_total: number;
  config: Record<string, unknown>;
}

// --- Views (daily-grain reporting facts; see supabase/migrations/0004_views.sql) ---

export interface FunnelSummaryRow {
  stage: PipelineStage;
  opportunity_count: number;
  revenue_attached_cents: number;
  cash_collected_cents: number;
}

export interface RevenueSoldDailyRow {
  day: string;
  revenue_sold_cents: number;
  deals_sold: number;
}

export interface CashCollectedDailyRow {
  day: string;
  cash_collected_cents: number;
  deposits_collected_cents: number;
  refunded_cents: number;
}

export interface CompletedJobRevenueDailyRow {
  day: string;
  completed_job_revenue_cents: number;
  jobs_completed: number;
}

export interface ActivityDailyRow {
  performed_by: string;
  day: string;
  dials: number;
  connected_calls: number;
  texts: number;
  emails: number;
}

export interface AppointmentsDailyRow {
  day: string;
  appointments_total: number;
  appointments_confirmed: number;
  appointments_showed: number;
  appointments_no_showed: number;
}

export interface LeadsDailyBySourceRow {
  day: string;
  lead_source_id: string | null;
  source_name: string | null;
  source_category: LeadSourceCategory | null;
  leads: number;
  missing_attribution_count: number;
}

export interface OpportunityDailyBySourceRow {
  day: string;
  lead_source_id: string | null;
  source_name: string | null;
  revenue_sold_cents: number;
  cash_collected_cents: number;
  deals_sold: number;
}
