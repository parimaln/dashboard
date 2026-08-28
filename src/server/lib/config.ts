import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicConfigSchema, type PublicConfig } from '../../shared/config.js';
import type { ComponentDefinition } from '../../shared/component.js';

/**
 * Config is runtime data, not compiled output, so it resolves from the working
 * directory rather than from this module. That is what makes it possible to mount
 * a different config/ over the one baked into the image without rebuilding.
 */
const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'public.json');

export interface ConfigLoadResult {
  config: PublicConfig;
  /** component id -> that component's validated slice of `components`. */
  componentConfig: Map<string, unknown>;
  /** Human-readable problems that should stop the boot. */
  errors: string[];
  /** Where the config was read from, for the startup banner. */
  source: string;
}

/**
 * Loads config/public.json, falling back to config/public.example.json so a fresh
 * clone boots and renders something before the user has configured anything.
 */
export async function loadConfig(
  components: ComponentDefinition<unknown, unknown>[],
  configPath = process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH,
): Promise<ConfigLoadResult> {
  const errors: string[] = [];
  let raw: unknown = {};
  let source = configPath;

  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    const example = path.join(path.dirname(configPath), 'public.example.json');
    try {
      raw = JSON.parse(await readFile(example, 'utf8'));
      source = `${example} (fallback — copy it to public.json to customise)`;
    } catch (err) {
      errors.push(`Could not read ${configPath} or its .example fallback: ${err instanceof Error ? err.message : err}`);
    }
  }

  const parsed = publicConfigSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`config${issue.path.length ? '.' + issue.path.join('.') : ''}: ${issue.message}`);
    }
    return { config: publicConfigSchema.parse({}), componentConfig: new Map(), errors, source };
  }

  const config = parsed.data;
  const componentConfig = new Map<string, unknown>();

  // Each component validates its own slice, so a typo in one component's config
  // names that component instead of failing somewhere generic.
  for (const def of components) {
    const slice = config.components[def.id];
    if (!def.config) {
      componentConfig.set(def.id, slice ?? {});
      continue;
    }
    const result = def.config.safeParse(slice ?? {});
    if (result.success) {
      componentConfig.set(def.id, result.data);
    } else {
      for (const issue of result.error.issues) {
        errors.push(`config.components.${def.id}${issue.path.length ? '.' + issue.path.join('.') : ''}: ${issue.message}`);
      }
    }
  }

  // A layout entry naming a component that does not exist is nearly always a typo.
  for (const id of Object.keys(config.layout)) {
    if (!components.some((c) => c.id === id)) {
      errors.push(`config.layout.${id}: no component with that id exists in components/`);
    }
  }

  return { config, componentConfig, errors, source };
}
