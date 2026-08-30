import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import type { HandlerContext } from '../../src/shared/component.js';
import { isCalendarEventImportant, isChoreImportant, isEvening, prioritise, weekdayName } from './rules.js';

export interface BriefingConfig {
  /** Component ids whose data is offered to the model as context. */
  sources: string[];
  maxBullets: number;
  maxReminders: number;
  importantChoreLabels: string[];
  importantCalendarLabels: string[];
  importantChorePriorityMax: number;
  eveningCutoffHour: number;
}

export interface BriefingData {
  headline: string;
  bullets: string[];
  /**
   * Reminders derived from config/household.md that apply to today — the standing
   * weekly commitments a calendar does not hold.
   */
  reminders: string[];
  /**
   * A phrasing of the dressing advice, in the context of the day's plans. The
   * weather panel prefers this over its own rule-generated headline when present,
   * and falls back to the rules whenever the model is unavailable.
   */
  dressLine?: string;
  generatedAt: string;
  /** Which model produced this, shown in small print so a bad answer is traceable. */
  model: string;
}

// Resolved from the working directory so prompts/ can be edited without a rebuild.
const PROMPT_PATH = path.resolve(process.cwd(), 'prompts', 'briefing.md');

/**
 * Standing household context: who is in the family, the weekly rhythm, and the
 * recurring "bring the chess book on Monday" reminders that no calendar or chore
 * list ever holds. Written once by the user, read on every refresh so editing it
 * takes effect without a restart.
 */
const HOUSEHOLD_PATH = path.resolve(process.cwd(), 'config', 'household.md');

async function readHousehold(explicitPath: string | undefined): Promise<string | null> {
  for (const candidate of [explicitPath, HOUSEHOLD_PATH].filter((p): p is string => Boolean(p))) {
    try {
      const text = (await readFile(candidate, 'utf8')).trim();
      if (text) return text;
    } catch {
      // Optional file: absent simply means no standing context.
    }
  }
  return null;
}

/**
 * Structured output rather than prose. The panel renders `headline` and `bullets`
 * into fixed slots, so a model that rambles or emits markdown cannot break the
 * layout — the worst case is a truncated sentence, not a broken board.
 */
const briefingSchema = z.object({
  headline: z.string().describe('At most 12 words. The single most useful thing about today.'),
  bullets: z.array(z.string()).describe('0-3 complete sentences, at most 20 words each, most important first.'),
  // Optional: the extraction below and every consumer (BriefingData.dressLine?,
  // weather-yr's panel) already treats a missing dressLine/reminders as "none" —
  // a model that drops one of these fields under a long prompt must not cause the
  // whole briefing (including a perfectly fine headline/bullets) to be discarded.
  dressLine: z
    .string()
    .describe(
      'One sentence, at most 18 words, rephrasing the supplied dressing advice in the context of the day. ' +
        'Never contradict it, never add a garment it does not mention.',
    )
    .optional(),
  reminders: z
    .array(z.string())
    .describe(
      'Things to bring or do today that follow from the household notes and are not already on the ' +
        'calendar or the chore list. Empty array if the notes say nothing about today.',
    )
    .optional(),
});

/**
 * The model sees the same normalised data the panels render, assembled here rather
 * than scraped from the DOM. Trimmed hard: a wall briefing does not need every
 * hourly temperature, and a smaller context is faster on a local model.
 */
export function buildContext(ctx: HandlerContext<BriefingConfig>): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  const weather = ctx.readComponent<{
    now: { temperatureC: number; symbolCode: string; windSpeedMs: number; precipitationMm: number };
    dress: { adult: { headline: string; warning?: string } };
    daily: { date: string; minC: number; maxC: number; symbolCode: string }[];
  }>('weather-yr');
  if (weather) {
    context.weather = {
      now: weather.now,
      dressing: weather.dress.adult.headline,
      warning: weather.dress.adult.warning,
      tomorrow: weather.daily[1],
    };
  }

  const now = new Date();
  // Rule-based, not left to the model: only after this hour does "today's briefing"
  // also look ahead to tomorrow.
  const evening = isEvening(now, ctx.timeZone, ctx.config.eveningCutoffHour);

  const calendar = ctx.readComponent<{ events: { title: string; start: string; allDay: boolean; calendar: string }[] }>(
    'calendar-ics',
  );
  if (calendar) {
    const todayKey = now.toLocaleDateString('en-CA', { timeZone: ctx.timeZone });
    context.today = prioritise(
      calendar.events.filter((e) => e.start.slice(0, 10) === todayKey),
      (e) => isCalendarEventImportant(e, ctx.config),
    ).map((e) => ({
      title: e.title,
      at: e.allDay ? 'all day' : e.start.slice(11, 16),
      whose: e.calendar,
      important: isCalendarEventImportant(e, ctx.config),
    }));
    // Prioritise the full list before slicing to 6, so a flagged event further down
    // the chronological order can still make the cut rather than merely being
    // reordered within whichever 6 happened to come first.
    context.soon = prioritise(calendar.events, (e) => isCalendarEventImportant(e, ctx.config))
      .slice(0, 6)
      .map((e) => ({ title: e.title, on: e.start.slice(0, 10), important: isCalendarEventImportant(e, ctx.config) }));
  }

  const chores = ctx.readComponent<{
    chores: { name: string; bucket: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'someday'; assignee?: string; labels: string[]; priority?: number }[];
  }>('donetick');
  if (chores) {
    // Tomorrow's chores only join the main list in the evening; before the cutoff
    // they live solely in context.tomorrow below. Grouping by bucket first, then
    // prioritising within each group, keeps an important "tomorrow" chore from
    // outranking an unflagged "today" one.
    const buckets: ('overdue' | 'today' | 'tomorrow')[] = evening ? ['overdue', 'today', 'tomorrow'] : ['overdue', 'today'];
    const ordered = buckets.flatMap((bucket) =>
      prioritise(
        chores.chores.filter((c) => c.bucket === bucket),
        (c) => isChoreImportant(c, ctx.config),
      ),
    );
    context.chores = ordered
      .slice(0, 12)
      .map((c) => ({ name: c.name, when: c.bucket, who: c.assignee, important: isChoreImportant(c, ctx.config) }));
  }

  if (evening) {
    const tomorrowDate = new Date(now.getTime() + 86_400_000);
    const tomorrowKey = tomorrowDate.toLocaleDateString('en-CA', { timeZone: ctx.timeZone });
    const tomorrowEvents = calendar
      ? prioritise(
          calendar.events.filter((e) => e.start.slice(0, 10) === tomorrowKey),
          (e) => isCalendarEventImportant(e, ctx.config),
        ).map((e) => ({
          title: e.title,
          at: e.allDay ? 'all day' : e.start.slice(11, 16),
          important: isCalendarEventImportant(e, ctx.config),
        }))
      : [];
    const tomorrowChores = chores
      ? prioritise(
          chores.chores.filter((c) => c.bucket === 'tomorrow'),
          (c) => isChoreImportant(c, ctx.config),
        ).map((c) => ({ name: c.name, who: c.assignee, important: isChoreImportant(c, ctx.config) }))
      : [];
    // Only set when there's something to say — an empty tomorrow block would just
    // tell the model "nothing happens tomorrow" with no way to distinguish that
    // from "we don't know", so leave it absent instead.
    if (tomorrowEvents.length > 0 || tomorrowChores.length > 0) {
      context.tomorrow = { weekday: weekdayName(tomorrowDate, ctx.timeZone), events: tomorrowEvents, chores: tomorrowChores };
    }
  }

  const meals = ctx.readComponent<{ days: { date: string; entries: { type: string; title: string }[] }[] }>('mealie');
  if (meals) context.meals = meals.days.slice(0, 2);

  const countdown = ctx.readComponent<{ items: { label: string; daysUntil: number }[] }>('countdown');
  if (countdown) context.countdowns = countdown.items.slice(0, 3);

  const transit = ctx.readComponent<{ departures: { line: string; minutesUntil: number; destination: string }[] }>(
    'entur',
  );
  if (transit) context.departures = transit.departures.slice(0, 3);

  return context;
}

/** Waits briefly for sibling components to produce their first data at boot. */
async function waitForContext(ctx: HandlerContext<BriefingConfig>, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let context = buildContext(ctx);
  while (Object.keys(context).length === 0 && Date.now() < deadline && !ctx.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    context = buildContext(ctx);
  }
  return context;
}

export async function generateBriefing(ctx: HandlerContext<BriefingConfig>): Promise<BriefingData> {
  const baseURL = ctx.requireEnv('AI_BASE_URL');
  const modelId = ctx.requireEnv('AI_MODEL');
  // Local servers ignore the key but the OpenAI protocol requires the header.
  const apiKey = ctx.env('AI_API_KEY') ?? 'local';

  const context = await waitForContext(ctx);
  if (Object.keys(context).length === 0) {
    throw new Error('no component data available to brief on yet');
  }

  const system = await readFile(ctx.env('AI_PROMPT_PATH') ?? PROMPT_PATH, 'utf8');
  const household = await readHousehold(ctx.env('HOUSEHOLD_PATH'));

  const provider = createOpenAICompatible({ name: 'local', baseURL, apiKey });

  const tomorrow = (context as { tomorrow?: { weekday: string } }).tomorrow;
  const now = new Date();

  let object: z.infer<typeof briefingSchema>;
  try {
    ({ object } = await generateObject({
      model: provider(modelId),
      schema: briefingSchema,
      system,
      prompt: [
        `Today is ${now.toLocaleDateString('en-GB', {
          timeZone: ctx.timeZone,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}. It is now ${now.toLocaleTimeString('en-GB', {
          timeZone: ctx.timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}. Times in today's data below (event "at", "departures" minutesUntil, etc.) are ` +
          `relative to this moment — use it to judge what is imminent, in progress, or already past.`,
        tomorrow
          ? `\nIt is now evening. Also prepare for tomorrow (${tomorrow.weekday}) using the "tomorrow" section of ` +
            `today's data below, and any household notes relevant to that weekday.`
          : '',
        household ? `\nStanding household notes:\n\n${household}` : '',
        `\nToday's data:\n${JSON.stringify(context, null, 2)}`,
      ]
        .filter(Boolean)
        .join('\n'),
      abortSignal: ctx.signal,
      // A wall briefing is not worth a long stall on a busy local GPU.
      maxRetries: 1,
    }));
  } catch (err) {
    // A smaller local model occasionally returns JSON that doesn't validate. The
    // scheduler only logs err.message ("...did not match schema"), which doesn't
    // say what the model actually returned — capture that here for diagnosis.
    if (NoObjectGeneratedError.isInstance(err)) {
      ctx.log('ai-briefing: model output failed validation', {
        cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
        rawText: err.text?.slice(0, 1000),
      });
    }
    throw err;
  }

  return {
    headline: object.headline.trim(),
    bullets: object.bullets.slice(0, ctx.config.maxBullets).map((b) => b.trim()).filter(Boolean),
    dressLine: object.dressLine?.trim() || undefined,
    reminders: (object.reminders ?? []).slice(0, ctx.config.maxReminders).map((r) => r.trim()).filter(Boolean),
    generatedAt: new Date().toISOString(),
    model: modelId,
  };
}
