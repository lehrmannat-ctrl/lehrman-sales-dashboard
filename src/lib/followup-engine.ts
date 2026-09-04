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
 *       call twice a day (9am / 5pm) every day for 7 days, then once a day
 *       every OTHER day for the following week (days 8, 10, 12, 14). If
 *       there's still no answer after day 14, stop — do not keep generating
 *       tasks for that lead automatically.
 *   - Once contact is made, the lead is scored hot / warm / cold and moves
 *     to a recall cadence anchored on the first-contact date (or on a date
 *     the customer explicitly gave — see `customRecallDays`):
 *       hot:  3, 7, 10, 14 days after first contact
 *       warm: 7, 14, 21 days after first contact
 *       cold: 15, 30, 60 days after first contact
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

function atDayOffset(base: Date, dayOffset: number, hour: number, minute: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
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
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day, 9, 0)),
    });
    tasks.push({
      cadenceRule: `initial_contact_day${day + 1}_pm`,
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day, 17, 0)),
    });
  }

  for (const day of [8, 10, 12, 14]) {
    tasks.push({
      cadenceRule: `initial_contact_day${day}`,
      dueAt: skipSunday(atDayOffset(leadEnteredPipelineAt, day - 1, 9, 0)),
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
    dueAt: skipSunday(atDayOffset(firstContactedAt, day, 9, 0)),
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
