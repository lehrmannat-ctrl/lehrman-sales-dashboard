/**
 * Date-range presets for the dashboard's date filter, plus the matching
 * "previous comparable period" used for %-change-vs-prior-period on every
 * KPI card. All ranges are [start, end] INCLUSIVE calendar days in the
 * app's local timezone — callers convert to UTC boundaries when querying.
 *
 * Weeks are Monday-Sunday. The business is closed Sundays, so a week's last
 * day will simply show zero activity — that's real information (see
 * docs/kpi-dictionary.md), not a bug to work around here.
 */

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  start: Date;
  end: Date;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Monday=0 ... Sunday=6, unlike Date.getDay()'s Sunday=0. */
function isoWeekday(d: Date): number {
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}

function startOfWeek(d: Date): Date {
  return startOfDay(addDays(d, -isoWeekday(d)));
}
function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}
function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function resolveDateRange(
  preset: DateRangePreset,
  now: Date = new Date(),
  custom?: { start: Date; end: Date }
): DateRange {
  switch (preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = addDays(now, -1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "this_week":
      return { start: startOfWeek(now), end: endOfDay(addDays(startOfWeek(now), 6)) };
    case "last_week": {
      const lastWeekStart = addDays(startOfWeek(now), -7);
      return { start: lastWeekStart, end: endOfDay(addDays(lastWeekStart, 6)) };
    }
    case "this_month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "last_month": {
      const lastMonthAnchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: startOfMonth(lastMonthAnchor), end: endOfMonth(lastMonthAnchor) };
    }
    case "custom":
      if (!custom) throw new Error('resolveDateRange("custom", ...) requires a custom {start, end}.');
      return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
  }
}

/**
 * The immediately-preceding period of the same length, used for "% change
 * vs previous comparable period." For calendar-month presets this uses the
 * actual previous calendar month (which may have a different day count —
 * that's the expected, human definition of "vs last month").
 */
export function previousComparablePeriod(preset: DateRangePreset, range: DateRange): DateRange {
  if (preset === "this_month") {
    const anchor = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1);
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
  if (preset === "last_month") {
    const anchor = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1);
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
  const lengthDays = Math.round((startOfDay(range.end).getTime() - startOfDay(range.start).getTime()) / 86400000) + 1;
  const prevStart = addDays(range.start, -lengthDays);
  const prevEnd = addDays(range.end, -lengthDays);
  return { start: startOfDay(prevStart), end: endOfDay(prevEnd) };
}

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  custom: "Custom Range",
};
