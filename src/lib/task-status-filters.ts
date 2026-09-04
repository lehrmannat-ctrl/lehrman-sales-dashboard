import type { FollowUpTaskFilter } from "./queries";

/** Which task statuses the Tasks page's status filter can show. "all" isn't a real follow_up_status - it means "don't filter." */
export const TASK_STATUS_FILTERS: FollowUpTaskFilter[] = ["pending", "completed", "skipped", "canceled", "all"];

export const TASK_STATUS_FILTER_LABELS: Record<FollowUpTaskFilter, string> = {
  pending: "Pending",
  completed: "Completed",
  skipped: "Skipped",
  canceled: "Canceled",
  all: "All",
};

export function isTaskStatusFilter(value: string | undefined): value is FollowUpTaskFilter {
  return !!value && (TASK_STATUS_FILTERS as string[]).includes(value);
}
