import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComponentDefinition, ComponentState, HandlerContext } from '../../shared/component.js';
import type { PublicConfig } from '../../shared/config.js';
import { parseRefresh, scopedEnv } from './env.js';
import { fetchWithTimeout } from './fetch.js';
import { logger } from './log.js';

const log = logger('scheduler');

export type StateListener = (state: ComponentState) => void;

/**
 * Runs each enabled component's data handler on its own interval and holds the
 * latest result.
 *
 * The important behaviour is stale-while-revalidate: a failed refresh never clears
 * the previous result. If Mealie reboots at 18:00 the panel keeps showing the last
 * good meal plan behind a dim staleness dot, rather than going blank on a screen
 * nobody is sitting in front of.
 */
/**
 * How far past its interval a component may drift before the watchdog re-runs it,
 * and how much older than that before its data is reported stale to the browser.
 */
const OVERDUE_FACTOR = 1.5;
const STALE_FACTOR = 2.5;
const WATCHDOG_INTERVAL_MS = 30_000;

export class Scheduler {
  private readonly states = new Map<string, ComponentState>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly intervals = new Map<string, number>();
  private readonly startedAt = new Map<string, number>();
  private readonly listeners = new Set<StateListener>();
  private readonly abort = new AbortController();
  private watchdog: NodeJS.Timeout | null = null;
  private clientsConnected = 0;

  constructor(
    private readonly components: ComponentDefinition<unknown, unknown>[],
    private readonly config: PublicConfig,
    private readonly componentConfig: Map<string, unknown>,
  ) {
    for (const def of components) {
      this.states.set(def.id, { id: def.id, data: null, stale: false, updatedAt: null });
    }
  }

  getState(id: string): ComponentState | undefined {
    return this.states.get(id);
  }

  getAllStates(): ComponentState[] {
    return [...this.states.values()];
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Kicks off every handler immediately, then on its declared interval. */
  start(): void {
    for (const def of this.components) {
      if (!def.server) continue;
      const intervalMs = parseRefresh(def.server.refresh);

      void this.run(def);
      if (intervalMs !== null) {
        this.intervals.set(def.id, intervalMs);
        const timer = setInterval(() => void this.run(def), intervalMs);
        // Do not hold the process open purely for a refresh timer.
        timer.unref?.();
        this.timers.set(def.id, timer);
      }
    }

    /*
     * setInterval is not a guarantee. If the Docker host suspends, or the
     * container is paused, timers simply do not fire for that period and every
     * panel silently keeps showing yesterday's data. This sweeps for components
     * that are overdue and re-runs them, which is what makes the board correct
     * again within thirty seconds of the machine waking up.
     */
    this.watchdog = setInterval(() => this.sweep(), WATCHDOG_INTERVAL_MS);
    this.watchdog.unref?.();
  }

  /** Re-runs anything meaningfully past its refresh interval. */
  private sweep(): void {
    if (this.abort.signal.aborted) return;
    const now = Date.now();

    for (const def of this.components) {
      const intervalMs = this.intervals.get(def.id);
      if (!def.server || intervalMs === undefined) continue;

      const state = this.states.get(def.id);
      // A component that has never succeeded is already being retried by its own
      // timer; only chase ones whose last success has aged out.
      const since = state?.updatedAt ?? this.startedAt.get(def.id);
      if (since === undefined) continue;

      if (now - since > intervalMs * OVERDUE_FACTOR) {
        log.debug(`"${def.id}" is overdue by ${Math.round((now - since - intervalMs) / 1000)}s; refreshing`);
        void this.run(def);
      } else if (state && state.data !== null && !state.stale && now - since > intervalMs * STALE_FACTOR) {
        // Should be unreachable given the branch above, but if a refresh is wedged
        // the board must say so rather than present old data as current.
        this.publish({ ...state, stale: true, error: 'data has not refreshed recently' });
      }
    }
  }

  /**
   * Called by the `/api/stream` route as browsers connect and disconnect. Going
   * from zero to one immediately catches up any `activeClientsOnly` component
   * whose data is missing or has aged past its refresh interval, so opening the
   * dashboard after a long idle stretch does not wait a full interval for a
   * briefing to appear.
   */
  notifyClientConnected(): void {
    const wasIdle = this.clientsConnected === 0;
    this.clientsConnected += 1;
    if (!wasIdle) return;

    const now = Date.now();
    for (const def of this.components) {
      if (!def.server?.activeClientsOnly) continue;
      const intervalMs = this.intervals.get(def.id);
      const since = this.states.get(def.id)?.updatedAt;
      if (since === null || since === undefined || (intervalMs !== undefined && now - since >= intervalMs)) {
        void this.run(def);
      }
    }
  }

  notifyClientDisconnected(): void {
    this.clientsConnected = Math.max(0, this.clientsConnected - 1);
  }

  stop(): void {
    this.abort.abort(new Error('server shutting down'));
    if (this.watchdog) clearInterval(this.watchdog);
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  /** Runs one component's handler now. Exposed so a route can force a refresh. */
  async run(def: ComponentDefinition<unknown, unknown>): Promise<void> {
    if (!def.server) return;

    // Nobody is looking at the board: skip a refresh that would otherwise burn an
    // inference call (or similar cost) for no one. notifyClientConnected() catches
    // this back up the moment a browser connects.
    if (def.server.activeClientsOnly && this.clientsConnected === 0) return;

    // MOCK=1 substitutes a fixture for the handler, so the whole board can be
    // rendered and tested without reaching any upstream. Kept here rather than
    // branching inside each handler, so no component carries test-only code.
    if (process.env.MOCK === '1') {
      const fixture = await this.loadFixture(def.id);
      if (fixture !== null) {
        this.publish({ id: def.id, data: fixture, stale: false, updatedAt: Date.now() });
        return;
      }
    }

    const previous = this.states.get(def.id);
    this.startedAt.set(def.id, Date.now());
    const { env, requireEnv } = scopedEnv(def);
    const componentLog = logger(def.id);

    const ctx: HandlerContext<unknown> = {
      config: this.componentConfig.get(def.id),
      env,
      requireEnv,
      fetch: (input, init) => fetchWithTimeout(input, { ...init, signal: init?.signal ?? this.abort.signal }),
      timeZone: this.config.timeZone,
      log: (message, extra) => componentLog.info(message, extra),
      signal: this.abort.signal,
      readComponent: <T,>(id: string) => this.states.get(id)?.data as T | undefined,
    };

    try {
      const data = await def.server.handler(ctx);
      this.publish({
        id: def.id,
        data,
        stale: false,
        updatedAt: Date.now(),
        maxAgeMs: this.maxAgeFor(def.id),
      });
      componentLog.debug('refreshed');
    } catch (err) {
      if (this.abort.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`"${def.id}" refresh failed`, { error: message });
      // Keep whatever we last had; only the staleness flag changes.
      this.publish({
        id: def.id,
        data: previous?.data ?? null,
        stale: true,
        error: message,
        updatedAt: previous?.updatedAt ?? null,
        maxAgeMs: this.maxAgeFor(def.id),
      });
    }
  }

  private maxAgeFor(id: string): number | undefined {
    const intervalMs = this.intervals.get(id);
    return intervalMs === undefined ? undefined : intervalMs * STALE_FACTOR;
  }

  private async loadFixture(id: string): Promise<unknown | null> {
    const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', `${id}.json`);
    try {
      return JSON.parse(await readFile(fixturePath, 'utf8'));
    } catch {
      // No fixture for this component: fall through and run the real handler.
      return null;
    }
  }

  private publish(state: ComponentState): void {
    this.states.set(state.id, state);
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        log.warn('listener threw', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
