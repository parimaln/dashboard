import { describe, expect, it } from 'vitest';
import { daysUntil, buildItems, countdownEventSchema } from '../server.js';

const config = { maxEvents: 6, hidePastDays: 0 };
const TZ = 'Europe/Oslo';

describe('daysUntil', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    // 23:30 local on the 24th to the 25th is half an hour, but it is one day.
    expect(daysUntil('2026-09-25', new Date('2026-09-24T21:30:00Z'), TZ)).toBe(1);
  });

  it('is zero on the day itself regardless of the time', () => {
    expect(daysUntil('2026-09-25', new Date('2026-09-25T00:05:00Z'), TZ)).toBe(0);
    expect(daysUntil('2026-09-25', new Date('2026-09-25T21:55:00Z'), TZ)).toBe(0);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil('2026-09-25', new Date('2026-09-27T12:00:00Z'), TZ)).toBe(-2);
  });

  it('uses the configured timezone, not the server clock', () => {
    // 22:30 UTC is already the next day in Oslo (UTC+2 in September).
    const instant = new Date('2026-09-24T22:30:00Z');
    expect(daysUntil('2026-09-25', instant, 'Europe/Oslo')).toBe(0);
    expect(daysUntil('2026-09-25', instant, 'UTC')).toBe(1);
  });

  it('handles a daylight-saving transition without drifting', () => {
    // Europe/Oslo leaves summer time on 25 October 2026.
    expect(daysUntil('2026-10-26', new Date('2026-10-24T10:00:00Z'), TZ)).toBe(2);
  });
});

describe('buildItems', () => {
  const events = [
    { date: '2026-12-24', label: 'Christmas Eve' },
    { date: '2026-09-25', label: 'The big day' },
    { date: '2026-10-13', label: 'Autumn holiday' },
  ];

  it('sorts nearest first', () => {
    const items = buildItems(events, config, new Date('2026-09-01T12:00:00Z'), TZ);
    expect(items.map((i) => i.label)).toEqual(['The big day', 'Autumn holiday', 'Christmas Eve']);
  });

  it('drops events that have passed', () => {
    const items = buildItems(events, config, new Date('2026-11-01T12:00:00Z'), TZ);
    expect(items.map((i) => i.label)).toEqual(['Christmas Eve']);
  });

  it('keeps an event visible for the whole of its own day', () => {
    const items = buildItems(events, config, new Date('2026-09-25T20:00:00Z'), TZ);
    expect(items[0]).toMatchObject({ label: 'The big day', daysUntil: 0, isToday: true });
  });

  it('respects hidePastDays as a grace period', () => {
    const withGrace = buildItems(events, { ...config, hidePastDays: 3 }, new Date('2026-09-27T12:00:00Z'), TZ);
    expect(withGrace.map((i) => i.label)).toContain('The big day');
  });

  it('caps the list at maxEvents', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-1${(i % 2) + 1}-0${(i % 9) + 1}`,
      label: `Event ${i}`,
    }));
    expect(buildItems(many, { ...config, maxEvents: 4 }, new Date('2026-09-01T12:00:00Z'), TZ)).toHaveLength(4);
  });
});

describe('countdownEventSchema', () => {
  it('accepts the documented minimal shape', () => {
    expect(countdownEventSchema.safeParse({ date: '2026-09-25', label: 'Hi' }).success).toBe(true);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(countdownEventSchema.safeParse({ date: '25/09/2026', label: 'Hi' }).success).toBe(false);
  });

  it('rejects a non-hex colour', () => {
    expect(countdownEventSchema.safeParse({ date: '2026-09-25', label: 'Hi', colour: 'red' }).success).toBe(false);
  });
});
