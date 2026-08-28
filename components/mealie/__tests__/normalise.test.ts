import { describe, expect, it } from 'vitest';
import { normalise } from '../server.js';

const DATES = ['2026-09-03', '2026-09-04'];

describe('mealie normalise', () => {
  it('always returns one bucket per requested day, even when empty', () => {
    const days = normalise([], DATES, '/img/mealie');
    expect(days.map((d) => d.date)).toEqual(DATES);
    expect(days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('prefers the linked recipe name over the free-text title', () => {
    const days = normalise(
      [{ date: '2026-09-03', entryType: 'dinner', title: 'ignored', recipe: { id: 'r1', name: 'Salmon' } }],
      DATES,
      '/img/mealie',
    );
    expect(days[0]?.entries[0]?.title).toBe('Salmon');
  });

  it('falls back to a free-text note when there is no recipe', () => {
    const days = normalise([{ date: '2026-09-03', entryType: 'lunch', text: 'Leftovers' }], DATES, '/img/mealie');
    expect(days[0]?.entries[0]).toMatchObject({ title: 'Leftovers', description: 'Leftovers' });
  });

  it('routes images through this server, never at Mealie directly', () => {
    // The Mealie token must never reach the browser, so an entry's image URL has
    // to be a path on this server rather than an upstream URL.
    const days = normalise(
      [{ date: '2026-09-03', entryType: 'dinner', recipe: { id: 'abc-123', name: 'Pie' } }],
      DATES,
      '/img/mealie',
    );
    expect(days[0]?.entries[0]?.imageUrl).toBe('/img/mealie/abc-123');
  });

  it('omits the image when the entry has no recipe', () => {
    const days = normalise([{ date: '2026-09-03', text: 'Takeaway' }], DATES, '/img/mealie');
    expect(days[0]?.entries[0]?.imageUrl).toBeUndefined();
  });

  it('orders entries as they are eaten', () => {
    const days = normalise(
      [
        { date: '2026-09-03', entryType: 'dinner', title: 'D' },
        { date: '2026-09-03', entryType: 'breakfast', title: 'B' },
        { date: '2026-09-03', entryType: 'lunch', title: 'L' },
      ],
      DATES,
      '/img/mealie',
    );
    expect(days[0]?.entries.map((e) => e.title)).toEqual(['B', 'L', 'D']);
  });

  it('ignores entries outside the requested range', () => {
    const days = normalise([{ date: '2026-09-09', entryType: 'dinner', title: 'Later' }], DATES, '/img/mealie');
    expect(days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('accepts a full timestamp where a date is expected', () => {
    const days = normalise(
      [{ date: '2026-09-03T00:00:00Z', entryType: 'dinner', title: 'X' }],
      DATES,
      '/img/mealie',
    );
    expect(days[0]?.entries).toHaveLength(1);
  });

  it('defaults a missing entry type to dinner', () => {
    const days = normalise([{ date: '2026-09-03', title: 'X' }], DATES, '/img/mealie');
    expect(days[0]?.entries[0]?.type).toBe('dinner');
  });
});
