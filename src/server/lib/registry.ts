import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ComponentDefinition } from '../../shared/component.js';

/**
 * Components are discovered by scanning the `components/` directory at boot.
 * There is no registry file to edit: dropping in a folder installs a component,
 * deleting the folder uninstalls it.
 *
 * This resolves correctly in both dev (tsx, `components/x/manifest.ts`) and
 * production (compiled, `dist/server/components/x/manifest.js`) because the
 * server build preserves the repository's directory structure, leaving this
 * module the same three levels below the components directory in both cases.
 */
const COMPONENTS_DIR = fileURLToPath(new URL('../../../components/', import.meta.url));
const EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

export interface LoadedComponent {
  definition: ComponentDefinition<unknown, unknown>;
  dir: string;
}

/** A manifest that failed to load. Surfaced at boot rather than silently dropped. */
export interface RegistryProblem {
  id: string;
  error: string;
}

export interface Registry {
  components: LoadedComponent[];
  problems: RegistryProblem[];
}

export async function loadRegistry(dir = COMPONENTS_DIR): Promise<Registry> {
  let entries: string[];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { components: [], problems: [{ id: '*', error: `components directory not found at ${dir}` }] };
  }

  const components: LoadedComponent[] = [];
  const problems: RegistryProblem[] = [];

  for (const id of entries) {
    const manifestPath = path.join(dir, id, `manifest.${EXT}`);
    try {
      const mod: unknown = await import(/* @vite-ignore */ manifestPath);
      const definition = (mod as { default?: ComponentDefinition<unknown, unknown> }).default;
      if (!definition) {
        problems.push({ id, error: 'manifest.ts has no default export' });
        continue;
      }
      // The folder name is the id. Enforcing it keeps layout config, API routes and
      // panel lookup consistent without a second source of truth.
      if (definition.id !== id) {
        problems.push({ id, error: `manifest id "${definition.id}" does not match folder name "${id}"` });
        continue;
      }
      components.push({ definition, dir: path.join(dir, id) });
    } catch (err) {
      problems.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { components, problems };
}
