/**
 * The component contract.
 *
 * A component is a folder under `components/`. It contains:
 *
 *   manifest.ts   required, server-safe: identity, env needs, config schema, data handler
 *   panel.tsx     optional, browser-only: the React view, default-exported
 *   README.md     optional, human docs
 *
 * The two halves are deliberately separate files so the server never imports React
 * and the browser bundle never imports a secret-holding data handler. They are linked
 * by folder name, which is also the component id.
 *
 * See docs/COMPONENTS.md for a worked example.
 */
import type { z } from 'zod';

/** How often a component's data handler re-runs. `"10m"`, `"30s"`, `"1h"`, or `false` for once at boot. */
export type Refresh = `${number}${'s' | 'm' | 'h'}` | false;

/** What a data handler is given when it runs. */
export interface HandlerContext<C = unknown> {
  /** This component's validated config, from `config/public.json`. */
  config: C;
  /** Read a declared environment variable. Throws if it was not declared in the manifest. */
  env: (name: string) => string | undefined;
  /** Same, but throws a helpful error if unset — use for `env.required` values. */
  requireEnv: (name: string) => string;
  /** Fetch with a timeout, so one unreachable LAN service cannot stall the scheduler. */
  fetch: (input: string | URL, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  /** IANA timezone from global config, e.g. `"Europe/Oslo"`. */
  timeZone: string;
  /** Structured logger scoped to this component. */
  log: (message: string, extra?: Record<string, unknown>) => void;
  /** Aborted when the server is shutting down or the refresh is superseded. */
  signal: AbortSignal;
  /**
   * Read another component's most recent data.
   *
   * Deliberately one-way and read-only: it exists so a summarising component (the
   * AI briefing) can see what the rest of the board is showing without every
   * component gaining a dependency on every other. Returns undefined when the
   * other component is disabled or has not produced data yet, so callers must
   * treat every source as optional.
   */
  readComponent: <T = unknown>(id: string) => T | undefined;
}

export interface ComponentEnvSpec {
  /** Without every one of these set, the component reports itself disabled and is skipped. */
  required?: readonly string[];
  /** Used when present; the component still runs without them. */
  optional?: readonly string[];
  /** Shown in generated docs and `.env.example`. Keyed by variable name. */
  describe?: Readonly<Record<string, string>>;
}

export interface ComponentDefinition<C = unknown, D = unknown> {
  /** Must equal the folder name. Used as the id everywhere: layout, API routes, SSE events. */
  id: string;
  /** Human-readable name for docs and logs. */
  name: string;
  /** One-line description for the generated component table. */
  description?: string;
  /** Environment variables this component reads. Drives feature detection and docs. */
  env?: ComponentEnvSpec;
  /**
   * Schema for this component's entry in `config/public.json`. Validated at boot.
   *
   * The input type is deliberately loose: `.default()` and `.optional()` make a
   * schema's input differ from its output, and only the output — the config a
   * handler actually receives — needs to be pinned.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: z.ZodType<C, z.ZodTypeDef, any>;
  /** Server-side data provider. Omit for components that need no data (e.g. the clock). */
  server?: {
    refresh: Refresh;
    handler: (ctx: HandlerContext<C>) => Promise<D>;
    /**
     * Skip refreshes while no browser has the dashboard open. For an expensive
     * handler (an LLM call) there is no point paying for a refresh nobody will see;
     * the scheduler catches up immediately once a client connects.
     */
    activeClientsOnly?: boolean;
    /**
     * Optional image resolver. Upstreams like Mealie serve recipe images behind the
     * same token as their API, so the browser cannot load them directly without the
     * token leaking into the page. A component that returns image references in its
     * data implements this, and the panel points `<img>` at `/img/<id>/<ref>`; the
     * server resolves and streams the bytes, keeping credentials server-side.
     */
    images?: (ctx: HandlerContext<C>, ref: string) => Promise<{ url: string; headers?: Record<string, string> }>;
  };
}

/**
 * Identity function that pins the generic types so a manifest gets full inference
 * on `ctx.config` inside its handler, and the panel gets the handler's return type.
 */
export function defineComponent<C, D>(def: ComponentDefinition<C, D>): ComponentDefinition<C, D> {
  return def;
}

/** What the browser is told about a component. Never includes env values. */
export interface ComponentDescriptor {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Populated when `enabled` is false — names the missing variables, for the setup screen. */
  missingEnv?: string[];
  /** True when this component has a server-side data handler. */
  hasData: boolean;
}

/** One component's data as pushed to the browser. */
export interface ComponentState<D = unknown> {
  id: string;
  /** Last successful payload, or null if it has never succeeded. */
  data: D | null;
  /** True when the most recent refresh failed and `data` is a previous, still-displayed result. */
  stale: boolean;
  /** Message from the most recent failure, for the staleness indicator's tooltip. */
  error?: string;
  /** Epoch ms of the last successful refresh. */
  updatedAt: number | null;
  /**
   * How old this data is allowed to get before it counts as stale, in ms.
   * Derived from the component's refresh interval. Lets the panel show that data
   * has gone cold even when no refresh has actually thrown — the case where a
   * timer never fired because the host was suspended.
   */
  maxAgeMs?: number;
}
