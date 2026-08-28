import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { HandlerContext } from '../../src/shared/component.js';

export interface CountdownConfig {
  maxEvents: number;
  hidePastDays: number;
}

/**
 * The data model: a date and what happens on it. Nothing else is required.
 * Edit config/events.json and the strip updates on the next refresh.
 */
export const countdownEventSchema = z.object({
  /** Calendar date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date like 2026-09-25'),
  label: z.string().min(1),
  emoji: z.string().optional(),
  /** Optional accent colour for this entry. */
  colour: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
});

export type CountdownEvent = z.infer<typeof countdownEventSchema>;

export interface CountdownItem extends CountdownEvent {
  daysUntil: number;
  /** True on the day itself. */
  isToday: boolean;
}

export interface CountdownData {
  items: CountdownItem[];
}

// Resolved from the working directory so config/ can be mounted over at runtime.
const EVENTS_PATH = path.resolve(process.cwd(), 'config', 'events.json');

/** Whole calendar days between two dates in a given timezone, ignoring clock time. */
export function daysUntil(target: string, now: Date, timeZone: string): number {
  const todayKey = now.toLocaleDateString('en-CA', { timeZone });
  const a = Date.parse(`${todayKey}T00:00:00Z`);
  const b = Date.parse(`${target}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function buildItems(
  events: CountdownEvent[],
  config: CountdownConfig,
  now: Date,
  timeZone: string,
): CountdownItem[] {
  return events
    .map((event) => {
      const days = daysUntil(event.date, now, timeZone);
      return { ...event, daysUntil: days, isToday: days === 0 };
    })
    // Keep an event visible for a short grace period after it passes, so the board
    // still says "today" for the whole of the day itself.
    .filter((item) => item.daysUntil >= -config.hidePastDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, config.maxEvents);
}

export async function loadCountdowns(ctx: HandlerContext<CountdownConfig>): Promise<CountdownData> {
  const eventsPath = ctx.env('COUNTDOWN_EVENTS_PATH') ?? EVENTS_PATH;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(eventsPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not read countdown events from ${path.resolve(eventsPath)}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const parsed = z.array(countdownEventSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`config/events.json is invalid at [${issue?.path.join('.')}]: ${issue?.message}`);
  }

  return { items: buildItems(parsed.data, ctx.config, new Date(), ctx.timeZone) };
}
