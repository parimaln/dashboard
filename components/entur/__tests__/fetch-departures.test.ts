import { describe, expect, it, vi } from 'vitest';
import { fetchDepartures, type EnturConfig } from '../server.js';
import type { HandlerContext } from '../../../src/shared/component.js';

const config: EnturConfig = {
  fromStopId: 'NSR:StopPlace:337',
  toStopId: 'NSR:StopPlace:58366',
  maxDepartures: 5,
  walkingMinutes: 8,
};

function makeCtx(fetchImpl: typeof fetch): HandlerContext<EnturConfig> {
  return {
    config,
    env: () => undefined,
    requireEnv: (name) => {
      throw new Error(`unexpected requireEnv(${name})`);
    },
    fetch: fetchImpl as HandlerContext<EnturConfig>['fetch'],
    timeZone: 'Europe/Oslo',
    log: vi.fn(),
    signal: new AbortController().signal,
    readComponent: () => undefined,
  };
}

describe('fetchDepartures', () => {
  it('throws with the status when Entur responds non-ok', async () => {
    const ctx = makeCtx(vi.fn().mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' })));
    await expect(fetchDepartures(ctx)).rejects.toThrow(/503/);
  });

  it('throws with the message when Entur returns GraphQL errors', async () => {
    const body = JSON.stringify({ errors: [{ message: 'Unknown StopPlace' }] });
    const ctx = makeCtx(vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(fetchDepartures(ctx)).rejects.toThrow(/Unknown StopPlace/);
  });

  it('parses a successful response into departures', async () => {
    const t = new Date(Date.now() + 20 * 60_000).toISOString();
    const payload = {
      data: {
        trip: {
          tripPatterns: [
            {
              expectedStartTime: t,
              aimedStartTime: t,
              legs: [
                { mode: 'foot', aimedStartTime: t, expectedStartTime: t, fromPlace: { name: 'Home' } },
                {
                  mode: 'rail',
                  realtime: true,
                  aimedStartTime: t,
                  expectedStartTime: t,
                  line: { publicCode: 'R11' },
                  fromEstimatedCall: { destinationDisplay: { frontText: 'Skien' } },
                  fromPlace: { name: 'Home' },
                },
              ],
            },
          ],
        },
      },
    };
    const ctx = makeCtx(vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
    const result = await fetchDepartures(ctx);
    expect(result.from).toBe('Home');
    expect(result.departures).toHaveLength(1);
    expect(result.departures[0]).toMatchObject({ line: 'R11', destination: 'Skien' });
  });
});
