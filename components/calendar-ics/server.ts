import ical from 'node-ical';
import type { HandlerContext } from '../../src/shared/component.js';
import { calendarSourceSchema, type CalendarSource } from '../../src/shared/config.js';

export interface CalendarConfig {
  daysAhead: number;
  maxEvents: number;
  showDeclined: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO instant. All-day events are anchored to local midnight. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  /** Which source calendar this came from. */
  calendar: string;
  colour: string;
}

export interface CalendarData {
  events: CalendarEvent[];
  /** Sources that failed this refresh; the rest still render. */
  failedSources: string[];
}

/**
 * `CALENDAR_ICS_URLS` holds one or more `url|Label|#colour` triples, comma separated.
 *
 * Commas are legal inside a URL's query string, so entries are split on commas that
 * are followed by something that looks like the start of a new URL rather than on
 * every comma.
 */
export function parseSources(raw: string): CalendarSource[] {
  const chunks = raw
    .split(/,(?=\s*https?:\/\/)/)
    .map((c) => c.trim())
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const parts = chunk.split('|').map((p) => p.trim());
    const source = {
      url: parts[0] ?? '',
      label: parts[1] || `Calendar ${index + 1}`,
      colour: parts[2] || '#4f9cf9',
    };
    const parsed = calendarSourceSchema.safeParse(source);
    if (!parsed.success) {
      throw new Error(
        `CALENDAR_ICS_URLS entry ${index + 1} is invalid (${parsed.error.issues[0]?.message}). ` +
          `Expected "https://…/basic.ics|Label|#4f9cf9".`,
      );
    }
    return parsed.data;
  });
}

/** Google emits all-day events as UTC-midnight dates; render them on the intended day. */
function isAllDay(event: ical.VEvent): boolean {
  return (event.datetype as string | undefined) === 'date';
}

/**
 * Expands recurring events into concrete occurrences inside the window.
 *
 * node-ical gives us the rrule and the exception/override maps but does not apply
 * them, so this has to reconcile three things: generated occurrences, EXDATEs that
 * delete one, and RECURRENCE-ID overrides that move or retitle one.
 */
export function expandEvents(
  parsed: Record<string, ical.CalendarComponent>,
  source: CalendarSource,
  windowStart: Date,
  windowEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];

  for (const [key, component] of Object.entries(parsed)) {
    if (component.type !== 'VEVENT') continue;
    const event = component as ical.VEvent;
    if (!event.start || !event.end) continue;

    const allDay = isAllDay(event);
    const durationMs = Math.max(0, new Date(event.end).getTime() - new Date(event.start).getTime());

    const push = (start: Date, override?: ical.VEvent) => {
      const end = new Date(start.getTime() + durationMs);
      if (end < windowStart || start > windowEnd) return;
      out.push({
        id: `${source.label}:${key}:${start.toISOString()}`,
        title: String(override?.summary ?? event.summary ?? '(no title)'),
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        location: (override?.location ?? event.location) ? String(override?.location ?? event.location) : undefined,
        calendar: source.label,
        colour: source.colour,
      });
    };

    if (!event.rrule) {
      push(new Date(event.start));
      continue;
    }

    // between() is inclusive of the bounds; widen the start so a long event that
    // began before the window but is still running today is not dropped.
    const occurrences = event.rrule.between(new Date(windowStart.getTime() - durationMs), windowEnd, true);

    const exdates = new Set(
      Object.values((event.exdate ?? {}) as Record<string, Date>).map((d) => new Date(d).toDateString()),
    );
    const overrides = (event.recurrences ?? {}) as Record<string, ical.VEvent>;

    for (const occurrence of occurrences) {
      if (exdates.has(occurrence.toDateString())) continue;

      const overrideKey = Object.keys(overrides).find(
        (k) => new Date(k).toDateString() === occurrence.toDateString(),
      );
      const override = overrideKey ? overrides[overrideKey] : undefined;
      push(override?.start ? new Date(override.start) : occurrence, override);
    }
  }

  return out;
}

export async function fetchCalendars(ctx: HandlerContext<CalendarConfig>): Promise<CalendarData> {
  const sources = parseSources(ctx.requireEnv('CALENDAR_ICS_URLS'));
  const now = new Date();
  const windowEnd = new Date(now.getTime() + ctx.config.daysAhead * 86_400_000);
  // Include events that started earlier today so an all-day event does not vanish at 00:01.
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);

  const events: CalendarEvent[] = [];
  const failedSources: string[] = [];

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const res = await ctx.fetch(source.url, { headers: { Accept: 'text/calendar' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      return { source, parsed: ical.sync.parseICS(text) };
    }),
  );

  for (const [index, result] of results.entries()) {
    const source = sources[index]!;
    if (result.status === 'rejected') {
      failedSources.push(source.label);
      ctx.log(`calendar "${source.label}" failed`, { error: String(result.reason?.message ?? result.reason) });
      continue;
    }
    events.push(...expandEvents(result.value.parsed, source, windowStart, windowEnd));
  }

  events.sort((a, b) => a.start.localeCompare(b.start));

  // Deduplicate: a shared family event often appears in two subscribed calendars.
  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    const key = `${e.title}|${e.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { events: deduped.slice(0, ctx.config.maxEvents), failedSources };
}
