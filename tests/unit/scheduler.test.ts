import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Scheduler } from '../../src/server/lib/scheduler.js';
import { defineComponent, type ComponentDefinition, type ComponentState } from '../../src/shared/component.js';
import { publicConfigSchema } from '../../src/shared/config.js';

const config = publicConfigSchema.parse({});

function makeComponent(
  id: string,
  handler: () => Promise<unknown>,
  refresh: `${number}m` = '10m',
  extra: Partial<NonNullable<ComponentDefinition<unknown, unknown>['server']>> = {},
): ComponentDefinition<unknown, unknown> {
  return defineComponent({
    id,
    name: id,
    config: z.object({}),
    server: { refresh, handler, ...extra },
  }) as ComponentDefinition<unknown, unknown>;
}

function schedulerFor(components: ComponentDefinition<unknown, unknown>[]) {
  return new Scheduler(components, config, new Map(components.map((c) => [c.id, {}])));
}

/**
 * Lets pending promise callbacks run between fake-timer advances. setImmediate is
 * deliberately left un-faked below so this still resolves.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Scheduler', () => {
  beforeEach(() => {
    // Only the timer APIs the scheduler uses are faked; setImmediate stays real
    // so pending promises can still be flushed between advances.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MOCK;
  });

  it('runs every handler once at startup', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler)]);

    scheduler.start();
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(scheduler.getState('a')).toMatchObject({ data: { ok: true }, stale: false });
    scheduler.stop();
  });

  it('refreshes on the declared interval', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m')]);

    scheduler.start();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('keeps the last good data when a refresh fails', async () => {
    // The behaviour that matters on a wall display: a service rebooting must not
    // blank the panel in front of a room that nobody is sitting in.
    const handler = vi
      .fn()
      .mockResolvedValueOnce({ meals: 2 })
      .mockRejectedValue(new Error('mealie is unreachable'));

    const scheduler = schedulerFor([makeComponent('a', handler, '10m')]);
    scheduler.start();
    await flush();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(scheduler.getState('a')).toMatchObject({
      data: { meals: 2 },
      stale: true,
      error: 'mealie is unreachable',
    });
    scheduler.stop();
  });

  it('recovers from stale back to fresh once the upstream returns', async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ v: 2 });

    const scheduler = schedulerFor([makeComponent('a', handler, '10m')]);
    scheduler.start();
    await flush();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(scheduler.getState('a')?.stale).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(scheduler.getState('a')).toMatchObject({ data: { v: 2 }, stale: false });
    scheduler.stop();
  });

  it('re-runs a component whose timer never fired', async () => {
    /*
     * The suspended-host case. If the Docker host sleeps, setInterval simply does
     * not fire for that period, and without a watchdog every panel would keep
     * presenting hours-old data as current. Simulated here by advancing the clock
     * without letting the component's own interval elapse in real terms.
     */
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m')]);

    scheduler.start();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    // Freeze the component's interval so only the watchdog can trigger a refresh.
    const state = scheduler.getState('a') as ComponentState;
    Object.assign(state, { updatedAt: Date.now() - 60 * 60_000 });

    // The watchdog sweeps every 30 seconds.
    await vi.advanceTimersByTimeAsync(31_000);

    expect(handler.mock.calls.length).toBeGreaterThan(1);
    scheduler.stop();
  });

  it('tells the browser how old data may get before it is stale', async () => {
    const scheduler = schedulerFor([makeComponent('a', vi.fn().mockResolvedValue({}), '10m')]);
    scheduler.start();
    await flush();

    // 2.5x the refresh interval.
    expect(scheduler.getState('a')?.maxAgeMs).toBe(10 * 60_000 * 2.5);
    scheduler.stop();
  });

  it('notifies subscribers on every state change', async () => {
    const listener = vi.fn();
    const scheduler = schedulerFor([makeComponent('a', vi.fn().mockResolvedValue({ ok: true }))]);

    scheduler.subscribe(listener);
    scheduler.start();
    await flush();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', data: { ok: true } }));
    scheduler.stop();
  });

  it('keeps running when one listener throws', async () => {
    const bad = vi.fn(() => {
      throw new Error('listener exploded');
    });
    const good = vi.fn();
    const scheduler = schedulerFor([makeComponent('a', vi.fn().mockResolvedValue({ ok: true }))]);

    scheduler.subscribe(bad);
    scheduler.subscribe(good);
    scheduler.start();
    await flush();

    expect(good).toHaveBeenCalled();
    scheduler.stop();
  });

  it('does not run an activeClientsOnly component while no browser is connected', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m', { activeClientsOnly: true })]);

    scheduler.start();
    await flush();
    expect(handler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('catches up an activeClientsOnly component the moment a client connects', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m', { activeClientsOnly: true })]);

    scheduler.start();
    await flush();
    expect(handler).not.toHaveBeenCalled();

    scheduler.notifyClientConnected();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('keeps refreshing an activeClientsOnly component on its interval while a client stays connected', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m', { activeClientsOnly: true })]);

    scheduler.start();
    scheduler.notifyClientConnected();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('stops refreshing an activeClientsOnly component once the last client disconnects', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m', { activeClientsOnly: true })]);

    scheduler.start();
    scheduler.notifyClientConnected();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.notifyClientDisconnected();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does not double-count multiple connected clients', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = schedulerFor([makeComponent('a', handler, '10m', { activeClientsOnly: true })]);

    scheduler.start();
    scheduler.notifyClientConnected();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    // A second tab connects, then the first disconnects: one client remains, so
    // refreshes must continue.
    scheduler.notifyClientConnected();
    scheduler.notifyClientDisconnected();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('stops all work on shutdown', async () => {
    const handler = vi.fn().mockResolvedValue({});
    const scheduler = schedulerFor([makeComponent('a', handler, '10m')]);

    scheduler.start();
    await flush();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
