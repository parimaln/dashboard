import type { ComponentType } from 'react';
import type { FormatContext } from './format.ts';

/** Props every component panel receives. */
export interface PanelProps<D = unknown, C = unknown> {
  /** This component's latest data, or null before its first successful refresh. */
  data: D | null;
  /** This component's slice of config/public.json, already validated by the server. */
  config: C;
  /** True when the last refresh failed and `data` is the previous result. */
  stale: boolean;
  /** Message from the most recent failed refresh, set even when `data` has never succeeded. */
  error?: string;
  /** Locale and timezone, for the helpers in ./format.ts. */
  format: FormatContext;
  /**
   * Read another component's current data, mirroring `ctx.readComponent` on the
   * server. Returns undefined when that component is disabled or has no data, so
   * a panel must treat it as a bonus and never as a dependency.
   */
  read: <T = unknown>(id: string) => T | undefined;
}

/**
 * Panels are discovered the same way manifests are: by scanning the components
 * directory. Adding `panel.tsx` to a component folder is the entire wiring step —
 * there is no registry file to edit.
 *
 * Vite resolves this glob at build time, so unused components are still tree-shaken
 * out of the bundle if they are not placed in the layout.
 */
const modules = import.meta.glob<{ default: ComponentType<PanelProps<never, never>> }>(
  '../../../components/*/panel.tsx',
  { eager: true },
);

const registry = new Map<string, ComponentType<PanelProps<never, never>>>();

for (const [path, module] of Object.entries(modules)) {
  // ../../../components/<id>/panel.tsx
  const id = path.split('/').at(-2);
  if (id && module.default) registry.set(id, module.default);
}

export function getPanel(id: string): ComponentType<PanelProps<never, never>> | undefined {
  return registry.get(id);
}

export function knownPanelIds(): string[] {
  return [...registry.keys()];
}
