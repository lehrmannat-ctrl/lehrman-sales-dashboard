/**
 * Due-date filter presets for the Tasks page. Deliberately a separate,
 * smaller module from src/lib/date-ranges.ts rather than an extension of
 * it: date-ranges.ts is used by backward-looking report pages (Revenue,
 * Calls, the funnel) that only ever look at what already happened, while
 * this list needs "Tomorrow" (tasks haven't happened yet) and "Overdue"
 * (pending tasks whose due date has already passed) - neither of which
 * makes sense on those other pages.
 */

export type TaskDueFilter =
  | "all"
  | "overdue"
  | "today"
  | "tomorrow"
  | "yesterday"
  | "this_week"
  | "this_month";

/** Half-open [start, end) range in the server's local time. Either bound can be open-ended. */
export interface TaskDueRange {
  start: Date | null;
  end: Date | null;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
/** Monday-start week, matching date-ranges.ts's convention elsewhere in the app. */
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // Sunday = 0
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(d), diff);
}
function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function resolveTaskDueRange(filter: TaskDueFilter, now: Date = new Date()): TaskDueRange {
  const today = startOfDay(now);
  switch (filter) {
    case "overdue":
      return { start: null, end: today };
    case "today":
      return { start: today, end: addDays(today, 1) };
    case "yesterday":
      return { start: addDays(today, -1), end: today };
    case "tomorrow":
      return { start: addDays(today, 1), end: addDays(today, 2) };
    case "this_week": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7) };
    }
    case "this_month": {
      const start = startOfMonth(today);
      return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
    }
    case "all":
    default:
      return { start: null, end: null };
  }
}

export const TASK_DUE_FILTERS: TaskDueFilter[] = [
  "all",
  "overdue",
  "today",
  "tomorrow",
  "yesterday",
  "this_week",
  "this_month",
];

export const TASK_DUE_FILTER_LABELS: Record<TaskDueFilter, string> = {
  all: "All",
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  this_week: "This Week",
  this_month: "This Month",
};

export function isTaskDueFilter(value: string | undefined): value is TaskDueFilter {
  return !!value && (TASK_DUE_FILTERS as string[]).includes(value);
}
