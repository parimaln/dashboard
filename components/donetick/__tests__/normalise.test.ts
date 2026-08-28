import { describe, expect, it } from 'vitest';
import { unwrap, normalise, daysBetween } from '../server.js';

const config = { maxChores: 40, hideCompleted: true, lookaheadDays: 21 };
const TZ = 'Europe/Oslo';
const NOW = new Date('2026-09-03T10:00:00Z');

describe('unwrap', () => {
  // Donetick is self-hosted, so people run whatever version they installed and
  // the envelope has varied between releases.
  it('accepts a bare array', () => {
    expect(unwrap([{ id: 1 }])).toHaveLength(1);
  });

  it.each(['res', 'data', 'items', 'chores', 'result'])('accepts a %s envelope', (key) => {
    expect(unwrap({ [key]: [{ id: 1 }] })).toHaveLength(1);
  });

  it('throws a clear error on an unrecognised shape', () => {
    expect(() => unwrap({ unexpected: true })).toThrow(/unrecognised response shape/);
  });
});

describe('daysBetween', () => {
  it('counts calendar days in the configured timezone', () => {
    expect(daysBetween(NOW, new Date('2026-09-05T04:00:00Z'), TZ)).toBe(2);
  });
});

describe('normalise', () => {
  it('accepts both name and title as the chore label', () => {
    const { chores } = normalise([{ id: 1, name: 'A' }, { id: 2, title: 'B' }], config, TZ, NOW);
    expect(chores.map((c) => c.name).sort()).toEqual(['A', 'B']);
  });

  it.each(['nextDueDate', 'dueDate', 'due_date'])('accepts %s as the due date field', (field) => {
    const { chores } = normalise([{ id: 1, name: 'A', [field]: '2026-09-04T09:00:00Z' }], config, TZ, NOW);
    expect(chores[0]?.bucket).toBe('tomorrow');
  });

  it('buckets by due date', () => {
    const { chores } = normalise(
      [
        { id: 1, name: 'Late', nextDueDate: '2026-09-01T09:00:00Z' },
        { id: 2, name: 'Now', nextDueDate: '2026-09-03T18:00:00Z' },
        { id: 3, name: 'Next', nextDueDate: '2026-09-04T09:00:00Z' },
        { id: 4, name: 'Later', nextDueDate: '2026-09-10T09:00:00Z' },
        { id: 5, name: 'Whenever' },
      ],
      config,
      TZ,
      NOW,
    );
    expect(chores.map((c) => c.bucket)).toEqual(['overdue', 'today', 'tomorrow', 'upcoming', 'someday']);
  });

  it('treats an earlier time today as already overdue', () => {
    const { chores } = normalise([{ id: 1, name: 'A', nextDueDate: '2026-09-03T06:00:00Z' }], config, TZ, NOW);
    expect(chores[0]?.bucket).toBe('overdue');
  });

  it('sorts overdue first, then by due date', () => {
    const { chores } = normalise(
      [
        { id: 1, name: 'Soon', nextDueDate: '2026-09-04T09:00:00Z' },
        { id: 2, name: 'Very late', nextDueDate: '2026-08-20T09:00:00Z' },
        { id: 3, name: 'Late', nextDueDate: '2026-09-01T09:00:00Z' },
      ],
      config,
      TZ,
      NOW,
    );
    expect(chores.map((c) => c.name)).toEqual(['Very late', 'Late', 'Soon']);
  });

  it('hides completed chores when configured to', () => {
    const raw = [{ id: 1, name: 'Done', isActive: false }, { id: 2, name: 'Open', isActive: true }];
    expect(normalise(raw, config, TZ, NOW).chores.map((c) => c.name)).toEqual(['Open']);
    expect(normalise(raw, { ...config, hideCompleted: false }, TZ, NOW).chores).toHaveLength(2);
  });

  it('drops chores beyond the lookahead window', () => {
    const { chores } = normalise([{ id: 1, name: 'Far off', nextDueDate: '2027-01-01T09:00:00Z' }], config, TZ, NOW);
    expect(chores).toHaveLength(0);
  });

  it('survives an invalid date rather than rendering NaN', () => {
    const { chores } = normalise([{ id: 1, name: 'Broken', nextDueDate: 'not-a-date' }], config, TZ, NOW);
    expect(chores[0]).toMatchObject({ bucket: 'someday', dueDate: null, daysUntil: null });
  });

  it('normalises labels given as strings or objects', () => {
    const { chores } = normalise(
      [{ id: 1, name: 'A', labels: ['kitchen', { name: 'weekly' }, null as never] }],
      config,
      TZ,
      NOW,
    );
    expect(chores[0]?.labels).toEqual(['kitchen', 'weekly']);
  });

  it('counts each bucket', () => {
    const { counts } = normalise(
      [
        { id: 1, name: 'A', nextDueDate: '2026-09-01T09:00:00Z' },
        { id: 2, name: 'B', nextDueDate: '2026-09-02T09:00:00Z' },
        { id: 3, name: 'C', nextDueDate: '2026-09-04T09:00:00Z' },
      ],
      config,
      TZ,
      NOW,
    );
    expect(counts.overdue).toBe(2);
    expect(counts.tomorrow).toBe(1);
  });

  it('caps the list at maxChores', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Chore ${i}` }));
    expect(normalise(raw, { ...config, maxChores: 10 }, TZ, NOW).chores).toHaveLength(10);
  });
});
