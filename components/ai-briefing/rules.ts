/**
 * "What matters enough to lead with" — deterministic rules, not inference.
 *
 * Mirrors components/weather-yr/dress.ts: the model in server.ts never decides
 * importance itself, it only phrases whatever these pure functions have already
 * flagged. That keeps the ordering testable and correct even when the model is
 * unreachable or ignores its instructions.
 */

export type ChoreBucketLike = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'someday';

export interface ChoreImportanceInput {
  bucket: ChoreBucketLike;
  labels: string[];
  priority?: number;
}

export interface CalendarImportanceInput {
  calendar: string;
}

export interface ImportanceConfig {
  importantChoreLabels: string[];
  importantCalendarLabels: string[];
  /**
   * Donetick's priority field is lower-is-more-urgent (P1 highest ... P4 lowest,
   * 0/unset = none) per Donetick's UI convention — this has not been independently
   * verified against every server version, so it defaults to 0 (disabled). A chore
   * counts as important when its priority is set, greater than 0, and at most this
   * value. See docs/AI.md before enabling it.
   */
  importantChorePriorityMax: number;
}

export function isChoreImportant(chore: ChoreImportanceInput, config: ImportanceConfig): boolean {
  if (chore.bucket === 'overdue') return true;
  if (config.importantChoreLabels.length > 0 && chore.labels.some((l) => config.importantChoreLabels.includes(l))) {
    return true;
  }
  if (
    config.importantChorePriorityMax > 0 &&
    chore.priority !== undefined &&
    chore.priority > 0 &&
    chore.priority <= config.importantChorePriorityMax
  ) {
    return true;
  }
  return false;
}

export function isCalendarEventImportant(
  event: CalendarImportanceInput,
  config: Pick<ImportanceConfig, 'importantCalendarLabels'>,
): boolean {
  return config.importantCalendarLabels.includes(event.calendar);
}

/**
 * Stable partition: items flagged important move first, each group keeping its
 * original relative order. Used so a flagged item can rise into a capped slice of
 * context sent to the model, rather than merely being reordered after the cap has
 * already excluded it.
 */
export function prioritise<T>(items: T[], important: (item: T) => boolean): T[] {
  const head: T[] = [];
  const tail: T[] = [];
  for (const item of items) (important(item) ? head : tail).push(item);
  return [...head, ...tail];
}

/** Local hour (0-23) in `timeZone`. */
export function localHour(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false })
    .formatToParts(date)
    .find((p) => p.type === 'hour')?.value;
  // Intl can render midnight as "24" with hour12: false.
  return Number(part ?? '0') % 24;
}

/** True at/after `cutoffHour` local time — the gate for pulling in tomorrow's highlights. */
export function isEvening(date: Date, timeZone: string, cutoffHour: number): boolean {
  return localHour(date, timeZone) >= cutoffHour;
}

/** Full weekday name for a given instant, in `timeZone`. */
export function weekdayName(date: Date, timeZone: string, locale = 'en-GB'): string {
  return date.toLocaleDateString(locale, { timeZone, weekday: 'long' });
}
