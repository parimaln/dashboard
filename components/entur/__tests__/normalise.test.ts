import { describe, expect, it } from 'vitest';
import { normalise } from '../server.js';

const config = { fromStopId: 'NSR:StopPlace:337', toStopId: 'NSR:StopPlace:1', maxDepartures: 5, walkingMinutes: 8 };
const NOW = new Date('2026-09-03T10:00:00Z');

const pattern = (minutes: number, overrides: Record<string, unknown> = {}) => {
  const t = new Date(NOW.getTime() + minutes * 60_000).toISOString();
  return {
    expectedStartTime: t,
    aimedStartTime: t,
    legs: [
      { mode: 'foot', aimedStartTime: t, expectedStartTime: t },
      {
        mode: 'rail',
        realtime: true,
        aimedStartTime: t,
        expectedStartTime: t,
        line: { publicCode: 'R11' },
        fromEstimatedCall: { destinationDisplay: { frontText: 'Skien' } },
        ...overrides,
      },
    ],
  };
};

describe('entur normalise', () => {
  it('reports the transport leg, not the walk to the platform', () => {
    const [departure] = normalise([pattern(20)], config, NOW);
    expect(departure).toMatchObject({ mode: 'rail', line: 'R11', destination: 'Skien' });
  });

  it('computes minutes until departure', () => {
    expect(normalise([pattern(23)], config, NOW)[0]?.minutesUntil).toBe(23);
  });

  it('flags a departure that cannot be walked to in time', () => {
    // The point of the panel is that a train you cannot reach should look
    // different from one you can.
    expect(normalise([pattern(3)], config, NOW)[0]?.unreachable).toBe(true);
    expect(normalise([pattern(30)], config, NOW)[0]?.unreachable).toBe(false);
  });

  it('drops departures that have already gone', () => {
    expect(normalise([pattern(-5)], config, NOW)).toHaveLength(0);
  });

  it('preserves a real-time delay so the panel can mark it', () => {
    const aimed = new Date(NOW.getTime() + 20 * 60_000).toISOString();
    const expected = new Date(NOW.getTime() + 24 * 60_000).toISOString();
    const [departure] = normalise(
      [{ legs: [{ mode: 'rail', aimedStartTime: aimed, expectedStartTime: expected, line: { publicCode: 'L1' } }] }],
      config,
      NOW,
    );
    expect(departure?.aimedTime).not.toBe(departure?.expectedTime);
    expect(departure?.minutesUntil).toBe(24);
  });

  it('falls back to the destination place when there is no estimated call', () => {
    const t = new Date(NOW.getTime() + 15 * 60_000).toISOString();
    const [departure] = normalise(
      [{ legs: [{ mode: 'bus', aimedStartTime: t, expectedStartTime: t, toPlace: { name: 'Sandvika' } }] }],
      config,
      NOW,
    );
    expect(departure?.destination).toBe('Sandvika');
  });

  it('caps the list at maxDepartures', () => {
    const patterns = Array.from({ length: 12 }, (_, i) => pattern(10 + i * 5));
    expect(normalise(patterns, config, NOW)).toHaveLength(5);
  });

  it('skips a pattern with no legs at all', () => {
    expect(normalise([{ legs: [] }, pattern(15)], config, NOW)).toHaveLength(1);
  });
});
