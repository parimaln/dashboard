import type { ComponentDefinition } from '../../shared/component.js';

/**
 * Tier 2 config: secrets and LAN addresses. Read from the process environment at
 * boot, never written to a git object, an image layer, or the browser.
 *
 * The set of variables is not hardcoded here — it is the union of what every
 * component manifest declares. That means `.env.example`, the docs table and this
 * validation can never drift from the code.
 */

/** Variables the server itself reads, independent of any component. */
export const CORE_ENV = {
  PORT: 'HTTP port to listen on (default 8080).',
  HOST: 'Interface to bind (default 0.0.0.0).',
  CONFIG_PATH: 'Path to public.json (default ./config/public.json).',
  MOCK: 'Set to 1 to serve fixture data instead of calling any upstream. Used by tests.',
  LOG_LEVEL: 'error | warn | info | debug (default info).',
  CLIENT_DIR: 'Path to the built client, relative to the working directory (default dist/client).',
} as const;

export interface EnvReport {
  /** Component id -> variables it declared as required but which are unset. */
  missingByComponent: Record<string, string[]>;
  /** Every variable name any component declared, required or optional. */
  declared: Set<string>;
}

export function auditEnv(
  components: ComponentDefinition<unknown, unknown>[],
  env: NodeJS.ProcessEnv = process.env,
): EnvReport {
  const missingByComponent: Record<string, string[]> = {};
  const declared = new Set<string>();

  for (const def of components) {
    for (const name of def.env?.optional ?? []) declared.add(name);

    const missing: string[] = [];
    for (const name of def.env?.required ?? []) {
      declared.add(name);
      const value = env[name];
      if (value === undefined || value.trim() === '') missing.push(name);
    }
    if (missing.length > 0) missingByComponent[def.id] = missing;
  }

  return { missingByComponent, declared };
}

/**
 * Builds the accessor handed to a component's data handler. A component can only
 * read variables it declared, so its env surface is visible in its manifest rather
 * than scattered through its code.
 */
export function scopedEnv(def: ComponentDefinition<unknown, unknown>, env: NodeJS.ProcessEnv = process.env) {
  const allowed = new Set<string>([...(def.env?.required ?? []), ...(def.env?.optional ?? [])]);

  const read = (name: string): string | undefined => {
    if (!allowed.has(name)) {
      throw new Error(
        `Component "${def.id}" read undeclared environment variable "${name}". ` +
          `Add it to env.required or env.optional in components/${def.id}/manifest.ts.`,
      );
    }
    const value = env[name];
    return value === undefined || value.trim() === '' ? undefined : value;
  };

  const requireEnv = (name: string): string => {
    const value = read(name);
    if (value === undefined) {
      throw new Error(`Component "${def.id}" requires environment variable "${name}", which is not set.`);
    }
    return value;
  };

  return { env: read, requireEnv };
}

/** `"10m"` -> 600000. `false` -> null (run once at boot, never refresh). */
export function parseRefresh(refresh: `${number}${'s' | 'm' | 'h'}` | false): number | null {
  if (refresh === false) return null;
  const match = /^(\d+)([smh])$/.exec(refresh);
  if (!match) throw new Error(`Invalid refresh interval "${refresh}". Use e.g. "30s", "10m", "1h", or false.`);
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h';
  const multiplier = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000;
  return value * multiplier;
}
