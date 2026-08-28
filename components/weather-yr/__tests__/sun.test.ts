import { describe, expect, it } from 'vitest';
import { solarTimes, isDaylight } from '../sun.js';

/** Minutes between two instants, for readable tolerance assertions. */
const minutesApart = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;

describe('solarTimes', () => {
  // These assert derivable physics rather than almanac values, so they stay
  // meaningful without a network and cannot be "fixed" by loosening a tolerance.

  it('places solar noon where the longitude says it should be', () => {
    // Solar noon at longitude L is 12:00 UTC minus L/15 hours, shifted by the
    // equation of time, which stays within about ±17 minutes across the year.
    const expectedNoonUtcMinutes = 12 * 60 - (10.7522 / 15) * 60;

    for (const date of ['2026-03-21', '2026-06-21', '2026-09-23', '2026-12-21']) {
      const { sunrise, sunset } = solarTimes(new Date(`${date}T12:00:00Z`), 59.9139, 10.7522);
      const noon = new Date((sunrise!.getTime() + sunset!.getTime()) / 2);
      const noonMinutes = noon.getUTCHours() * 60 + noon.getUTCMinutes();
      expect(Math.abs(noonMinutes - expectedNoonUtcMinutes)).toBeLessThan(17);
    }
  });

  it('gives a day just over twelve hours at the equinoxes', () => {
    // Refraction and the sun's apparent diameter make the equinox day slightly
    // longer than twelve hours, more so at high latitude.
    for (const date of ['2026-03-21', '2026-09-23']) {
      const { sunrise, sunset } = solarTimes(new Date(`${date}T12:00:00Z`), 59.9139, 10.7522);
      const hours = (sunset!.getTime() - sunrise!.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(12);
      expect(hours).toBeLessThan(12.5);
    }
  });

  it('reproduces Oslo day length at both solstices', () => {
    // Oslo's published extremes are about 18h50m and 5h54m.
    const lengthHours = (date: string) => {
      const { sunrise, sunset } = solarTimes(new Date(`${date}T12:00:00Z`), 59.9139, 10.7522);
      return (sunset!.getTime() - sunrise!.getTime()) / 3_600_000;
    };
    expect(lengthHours('2026-06-21')).toBeCloseTo(18.83, 1);
    expect(lengthHours('2026-12-21')).toBeCloseTo(5.9, 1);
  });

  it('is symmetric about solar noon', () => {
    const { sunrise, sunset } = solarTimes(new Date('2026-05-15T12:00:00Z'), 59.9139, 10.7522);
    const noon = (sunrise!.getTime() + sunset!.getTime()) / 2;
    expect(minutesApart(sunrise!, new Date(noon - (noon - sunrise!.getTime())))).toBeLessThan(1);
  });

  it('reports polar night and midnight sun above the Arctic Circle', () => {
    // Tromsø.
    const polarNight = solarTimes(new Date('2026-12-21T12:00:00Z'), 69.6496, 18.956);
    expect(polarNight.sunrise).toBeNull();
    expect(polarNight.polarDay).toBe(false);

    const midnightSun = solarTimes(new Date('2026-06-21T12:00:00Z'), 69.6496, 18.956);
    expect(midnightSun.sunset).toBeNull();
    expect(midnightSun.polarDay).toBe(true);
  });

  it('works in the southern hemisphere', () => {
    // Sydney in June is winter: the day should be short.
    const { sunrise, sunset } = solarTimes(new Date('2026-06-21T02:00:00Z'), -33.8688, 151.2093);
    const hours = (sunset!.getTime() - sunrise!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(9);
    expect(hours).toBeLessThan(11);
  });
});

describe('isDaylight', () => {
  it('is true at local noon and false at local midnight', () => {
    expect(isDaylight(new Date('2026-06-21T10:00:00Z'), 59.9139, 10.7522)).toBe(true);
    expect(isDaylight(new Date('2026-12-21T23:00:00Z'), 59.9139, 10.7522)).toBe(false);
  });

  it('treats polar day as daylight around the clock', () => {
    expect(isDaylight(new Date('2026-06-21T23:30:00Z'), 69.6496, 18.956)).toBe(true);
  });
});
