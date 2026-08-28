import { describe, expect, it } from 'vitest';
import { isCalendarEventImportant, isChoreImportant, isEvening, localHour, prioritise, weekdayName } from '../rules.js';

const importanceConfig = { importantChoreLabels: ['urgent'], importantCalendarLabels: ['Work'], importantChorePriorityMax: 2 };

describe('isChoreImportant', () => {
  it('is always important when overdue, regardless of labels or priority', () => {
    expect(isChoreImportant({ bucket: 'overdue', labels: [], priority: undefined }, importanceConfig)).toBe(true);
  });

  it('is important when a label matches', () => {
    expect(isChoreImportant({ bucket: 'today', labels: ['urgent'], priority: undefined }, importanceConfig)).toBe(true);
  });

  it('is important when priority is at or under the configured max', () => {
    expect(isChoreImportant({ bucket: 'today', labels: [], priority: 2 }, importanceConfig)).toBe(true);
    expect(isChoreImportant({ bucket: 'today', labels: [], priority: 3 }, importanceConfig)).toBe(false);
  });

  it('never flags on priority when importantChorePriorityMax is 0', () => {
    const config = { ...importanceConfig, importantChorePriorityMax: 0 };
    expect(isChoreImportant({ bucket: 'today', labels: [], priority: 1 }, config)).toBe(false);
  });

  it('is not important with none of the three signals', () => {
    expect(isChoreImportant({ bucket: 'tomorrow', labels: ['kitchen'], priority: 4 }, importanceConfig)).toBe(false);
  });

  it('never flags on an empty label list or unset priority', () => {
    const config = { importantChoreLabels: [], importantCalendarLabels: [], importantChorePriorityMax: 2 };
    expect(isChoreImportant({ bucket: 'today', labels: ['urgent'], priority: undefined }, config)).toBe(false);
  });
});

describe('isCalendarEventImportant', () => {
  it('matches only exact calendar label membership', () => {
    expect(isCalendarEventImportant({ calendar: 'Work' }, importanceConfig)).toBe(true);
    expect(isCalendarEventImportant({ calendar: 'Family' }, importanceConfig)).toBe(false);
  });

  it('never flags anything when the list is empty', () => {
    expect(isCalendarEventImportant({ calendar: 'Work' }, { importantCalendarLabels: [] })).toBe(false);
  });
});

describe('prioritise', () => {
  it('moves important items first, preserving relative order within each group', () => {
    const items = [
      { id: 1, imp: false },
      { id: 2, imp: true },
      { id: 3, imp: false },
      { id: 4, imp: true },
    ];
    expect(prioritise(items, (i) => i.imp).map((i) => i.id)).toEqual([2, 4, 1, 3]);
  });
});

describe('localHour / isEvening', () => {
  it('reads the hour in the given timezone', () => {
    expect(localHour(new Date('2026-09-03T13:59:00Z'), 'Europe/Oslo')).toBe(15);
    expect(localHour(new Date('2026-09-03T14:00:00Z'), 'Europe/Oslo')).toBe(16);
  });

  it('gates on the cutoff hour', () => {
    expect(isEvening(new Date('2026-09-03T13:59:00Z'), 'Europe/Oslo', 16)).toBe(false);
    expect(isEvening(new Date('2026-09-03T14:00:00Z'), 'Europe/Oslo', 16)).toBe(true);
  });
});

describe('weekdayName', () => {
  it('names the weekday in local time, not UTC', () => {
    // 23:30 local on a Thursday is already Friday in UTC.
    expect(weekdayName(new Date('2026-09-03T21:30:00Z'), 'Europe/Oslo')).toBe('Thursday');
  });
});
