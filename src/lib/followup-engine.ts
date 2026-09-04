/**
 * Follow-up cadence engine.
 *
 * Pure, dependency-free functions — no Supabase client here on purpose, so
 * the scheduling math can be unit tested and reasoned about without a
 * database. Callers (server actions / webhook handlers in
 * src/app/api/...) are responsible for writing the resulting tasks into
 * `follow_up_tasks` and for not re-running a lead through this engine twice
 * (see `hasCadenceAlreadyRun` guard pattern described below).
 *
 * Business rules encoded here (from the owner's spec):
 *   - The shop is NEVER open on Sundays. No task this engine produces may
 *     ever land on a Sunday — `skipSunday()` pushes it to Monday, same time.
 *   - Initial-contact cadence (a lead that has not yet been reached):
 *       call twice a day (morning / afternoon) every day for 7 days, then
 *       once a day every OTHER day for the following week (days 8, 10, 12,
 *       14). If there's still no answer after day 14, stop — do not keep
 *       generating tasks for that lead automatically.
 *   - Once contact is made, the lead is scored hot / warm / cold and moves
 *     to a recall cadence anchored on the first-contact date (or on a date
 *     the customer explicitly gave — see `customRecallDays`):
 *       hot:  3, 7, 10, 14 days after first contact
 *       warm: 7, 14, 21 days after first contact
 *       cold: 15, 30, 60 days after first contact
 *   - "Due" times: morning tasks are due at 11:30 AM, afternoon tasks are
 *     due at 4:30 PM, both in the shop's local time zone (America/New_York
 *     — Grand Rapids, MI), correctly accounting for EST/EDT. This governs
 *     only when a task is considered due, not how many tasks are generated
 *     or their cadence/frequency.
 */

export type LeadTemperature = "hot" | "warm" | "cold";

export interface CadenceTask {
  dueAt: Date;
  cadenceRule: string;
}

const RECALL_DAYS_BY_TEMPERATURE: Record<LeadTemperature, number[]> = {
  hot: [3, 7, 10, 14],
  warm: [7, 14, 21],
  cold: [15, 30, 60],
};

/** If a timestamp falls on a Sunday, push it to the same time on Monday. */
export function skipSunday(date: Date): Date {
  const copy = new Date(date.getTime());
  if (copy.getDay() === 0) {
    copy.setDate(copy.getDate() + 1);
  }
  return copy;
}

/** The shop's local time zone — all "due at" wall-clock times below are in this zone. */
const BUSINESS_TIMEZONE = "America/New_York";

/** Morning cadence tasks are due at 11:30 AM local time. */
const MORNING_DUE_TIME = { hour: 11, minute: 30 } as const;
/** Afternoon cadence tasks are due at 4:30 PM local time. */
const AFTERNOON_DUE_TIME = { hour: 16, minute: 30 } as const;

/**
 * Returns the UTC offset (in minutes, e.g. -240 for EDT, -300 for EST) that
 * `timeZone` observes at `date`. Uses Intl instead of a date library so this
 * stays dependency-free; `shortOffset` reliably yields a string like "GMT-4"
 * or "GMT-4:30" that we parse with a regex.
 */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const [, sign, hours, minutes = "0"] = match;
  const total = parseInt(hours, 10) * 60 + parseInt(minutes, 10);
  return sign === "-" ? -total : total;
}

/**
 * Advances `base` by `dayOffset` whole calendar days, then returns the
 * instant corresponding to `hour:minute` local wall-clock time in
 * `BUSINESS_TIMEZONE` on that day — correctly accounting for whichever of
 * EST/EDT is in effect at that date (no fixed offset assumption).
 */
function atDayOffset(base: Date, dayOffset: number, hour: number, minute: number): Date {
  const shifted = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  // Naive UTC guess at the target wall-clock time on the shifted date.
  const naiveUtcGuess = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour, minute, 0, 0)
  );
  // Correct by the zone's real offset at that instant (handles DST).
  const offsetMinutes = getTimeZoneOffsetMinutes(naiveUtcGuess, BUSINESS_TIMEZONE);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Generates the full initial-contact call cadence for a lead that just
 * entered "attempting contact": 14 calls over the first 7 days (2/day),
 * then 4 more every-other-day calls through day 14. 18 tasks total, then
 * the engine produces nothing further for that lead until it's manually
 * reactivated or contact is made.
 */
export function generateInitialContactTasks(leadEnteredPipelineAt: Date): CadenceTask[] {
  const tasks: CadenceTask[] = [];

  for (let day = 0; day < 7; day++) {
    tasks.push({
      cadenceRule: `initial_contact_day${day + 1}_am`,
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day, MORNING_DUE_TIME.hour, MORNING_DUE_TIME.minute)),
    });
    tasks.push({
      cadenceRule: `initial_contact_day${day + 1}_pm`,
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day, AFTERNOON_DUE_TIME.hour, AFTERNOON_DUE_TIME.minute)),
    });
  }

  for (const day of [8, 10, 12, 14]) {
    tasks.push({
      cadenceRule: `initial_contact_day${day}`,
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day - 1, MORNING_DUE_TIME.hour, MORNING_DUE_TIME.minute)),
    });
  }

  return tasks;
}

/**
 * Generates the hot/warm/cold recall cadence anchored on the first-contact
 * date. `customRecallDays` lets a rep override the default schedule when
 * "the customer provides" their own timeframe (e.g. "call me back in 3
 * weeks") — pass the day offsets they committed to instead of the default
 * temperature-based schedule.
 *
 * Recall tasks only have a morning slot (no am/pm split like initial
 * contact), so they use MORNING_DUE_TIME (11:30 AM local).
 */
export function generateRecallTasks(
  firstContactedAt: Date,
  temperature: LeadTemperature,
  customRecallDays?: number[]
): CadenceTask[] {
  const days = customRecallDays && customRecallDays.length > 0
    ? customRecallDays
    : RECALL_DAYS_BY_TEMPERATURE[temperature];

  return days.map((day) => ({
    cadenceRule: `${temperature}_recall_day${day}`,
    dueAt: skipSunday(atDayOffset(firstContactedAt, day, MORNING_DUE_TIME.hour, MORNING_DUE_TIME.minute)),
  }));
}

/**
 * Convenience used by the daily command center / stale-lead detection:
 * true once a lead has exhausted the 14-day initial-contact window without
 * ever being contacted, meaning the engine will not schedule anything more
 * for it automatically and it needs a human decision (keep trying manually,
 * or mark lost).
 */
export function initialContactWindowExhausted(leadEnteredPipelineAt: Date, now: Date = new Date()): boolean {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = (now.getTime() - leadEnteredPipelineAt.getTime()) / msPerDay;
  return daysElapsed > 14;
}
