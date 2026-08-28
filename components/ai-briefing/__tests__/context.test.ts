import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext, type BriefingConfig } from '../server.js';
import type { HandlerContext } from '../../../src/shared/component.js';

const TZ = 'Europe/Oslo';

const config: BriefingConfig = {
  sources: ['weather-yr', 'calendar-ics', 'donetick', 'mealie', 'countdown', 'entur'],
  maxBullets: 3,
  maxReminders: 3,
  importantChoreLabels: ['urgent'],
  importantCalendarLabels: ['Work'],
  importantChorePriorityMax: 2,
  eveningCutoffHour: 16,
};

interface CalendarEventFixture {
  title: string;
  start: string;
  allDay: boolean;
  calendar: string;
}

interface ChoreFixture {
  name: string;
  bucket: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'someday';
  assignee?: string;
  labels: string[];
  priority?: number;
}

function makeCtx(
  data: Partial<Record<string, unknown>>,
  configOverrides: Partial<BriefingConfig> = {},
): HandlerContext<BriefingConfig> {
  return {
    config: { ...config, ...configOverrides },
    env: () => undefined,
    requireEnv: (name) => {
      throw new Error(`unexpected requireEnv(${name})`);
    },
    fetch: vi.fn() as HandlerContext<BriefingConfig>['fetch'],
    timeZone: TZ,
    log: vi.fn(),
    signal: new AbortController().signal,
    readComponent: <T,>(id: string) => data[id] as T | undefined,
  };
}

describe('buildContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes tomorrow chores and omits context.tomorrow before the cutoff', () => {
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z')); // 12:00 CEST
    const chores: ChoreFixture[] = [
      { name: 'Today chore', bucket: 'today', labels: [] },
      { name: 'Tomorrow chore', bucket: 'tomorrow', labels: [] },
    ];
    const ctx = makeCtx({ donetick: { chores } });
    const context = buildContext(ctx);
    expect((context.chores as { name: string }[]).map((c) => c.name)).toEqual(['Today chore']);
    expect(context.tomorrow).toBeUndefined();
  });

  it('includes tomorrow highlights at/after the cutoff', () => {
    vi.setSystemTime(new Date('2026-09-03T14:30:00Z')); // 16:30 CEST
    const events: CalendarEventFixture[] = [
      { title: 'Today meeting', start: '2026-09-03T09:00:00Z', allDay: false, calendar: 'Family' },
      { title: 'Tomorrow trip', start: '2026-09-04T08:00:00Z', allDay: false, calendar: 'Family' },
    ];
    const chores: ChoreFixture[] = [
      { name: 'Today chore', bucket: 'today', labels: [] },
      { name: 'Tomorrow chore', bucket: 'tomorrow', labels: [] },
    ];
    const ctx = makeCtx({ 'calendar-ics': { events }, donetick: { chores } });
    const context = buildContext(ctx);

    expect(context.tomorrow).toMatchObject({
      weekday: 'Friday',
      events: [{ title: 'Tomorrow trip' }],
      chores: [{ name: 'Tomorrow chore' }],
    });
    // Tomorrow's chore also joins the main list in the evening.
    expect((context.chores as { name: string }[]).map((c) => c.name)).toEqual(['Today chore', 'Tomorrow chore']);
  });

  it('marks important chores/events and does not merge tomorrow chores before the cutoff', () => {
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
    const chores: ChoreFixture[] = [
      { name: 'Overdue', bucket: 'overdue', labels: [] },
      { name: 'Urgent today', bucket: 'today', labels: ['urgent'] },
      { name: 'Plain today', bucket: 'today', labels: [] },
    ];
    const ctx = makeCtx({ donetick: { chores } });
    const context = buildContext(ctx);
    const list = context.chores as { name: string; important: boolean }[];
    expect(list.find((c) => c.name === 'Overdue')?.important).toBe(true);
    expect(list.find((c) => c.name === 'Urgent today')?.important).toBe(true);
    expect(list.find((c) => c.name === 'Plain today')?.important).toBe(false);
  });

  it('prioritises an important chore into the capped list rather than dropping it', () => {
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
    // 13 "today" chores: 12 plain ones plus one flagged important, appended last.
    const plain: ChoreFixture[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Plain ${i}`,
      bucket: 'today',
      labels: [],
    }));
    const important: ChoreFixture = { name: 'Important last', bucket: 'today', labels: ['urgent'] };
    const ctx = makeCtx({ donetick: { chores: [...plain, important] } });
    const context = buildContext(ctx);
    const names = (context.chores as { name: string }[]).map((c) => c.name);
    expect(names).toHaveLength(12);
    expect(names).toContain('Important last');
  });

  it('prioritises an important calendar event into the capped "soon" list rather than dropping it', () => {
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
    const plain: CalendarEventFixture[] = Array.from({ length: 6 }, (_, i) => ({
      title: `Plain ${i}`,
      start: `2026-09-0${4 + i}T09:00:00Z`,
      allDay: false,
      calendar: 'Family',
    }));
    const important: CalendarEventFixture = {
      title: 'Important last',
      start: '2026-09-20T09:00:00Z',
      allDay: false,
      calendar: 'Work',
    };
    const ctx = makeCtx({ 'calendar-ics': { events: [...plain, important] } });
    const context = buildContext(ctx);
    const titles = (context.soon as { title: string }[]).map((e) => e.title);
    expect(titles).toHaveLength(6);
    expect(titles).toContain('Important last');
  });
});
