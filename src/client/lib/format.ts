/**
 * All date and number formatting goes through here so the configured locale and
 * timezone are applied consistently, rather than each panel reaching for its own
 * toLocaleString options.
 */
export interface FormatContext {
  locale: string;
  timeZone: string;
}

export function time(ctx: FormatContext, value: string | Date, withSeconds = false): string {
  return new Date(value).toLocaleTimeString(ctx.locale, {
    timeZone: ctx.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

export function weekday(ctx: FormatContext, value: string | Date, style: 'short' | 'long' = 'short'): string {
  return new Date(value).toLocaleDateString(ctx.locale, { timeZone: ctx.timeZone, weekday: style });
}

export function dayMonth(ctx: FormatContext, value: string | Date): string {
  return new Date(value).toLocaleDateString(ctx.locale, { timeZone: ctx.timeZone, day: 'numeric', month: 'short' });
}

export function isoDate(ctx: FormatContext, value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: ctx.timeZone });
}

/** ISO 8601 week number, which is what a Norwegian household actually uses. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday determines the year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** "today", "tomorrow", "Thu 3 Sep" — the shortest unambiguous rendering. */
export function relativeDay(ctx: FormatContext, value: string | Date, now = new Date()): string {
  const target = isoDate(ctx, value);
  const today = isoDate(ctx, now);
  const tomorrow = isoDate(ctx, new Date(now.getTime() + 86_400_000));
  if (target === today) return 'Today';
  if (target === tomorrow) return 'Tomorrow';
  return `${weekday(ctx, value)} ${dayMonth(ctx, value)}`;
}
