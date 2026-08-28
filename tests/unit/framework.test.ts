import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditEnv, scopedEnv, parseRefresh } from '../../src/server/lib/env.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { defineComponent, type ComponentDefinition } from '../../src/shared/component.js';
import { publicConfigSchema } from '../../src/shared/config.js';

// Widened to the erased form the registry and env helpers actually work with:
// ComponentDefinition is invariant in its config type because the handler takes
// it as a parameter, so a concretely-typed definition is not assignable to the
// unknown-typed one without this.
const component = (id: string, env?: { required?: string[]; optional?: string[] }): ComponentDefinition<unknown, unknown> =>
  defineComponent({ id, name: id, env, config: z.object({}) }) as ComponentDefinition<unknown, unknown>;

describe('parseRefresh', () => {
  it.each([
    ['30s', 30_000],
    ['10m', 600_000],
    ['1h', 3_600_000],
  ])('parses %s', (input, expected) => {
    expect(parseRefresh(input as `${number}s`)).toBe(expected);
  });

  it('treats false as run-once', () => {
    expect(parseRefresh(false)).toBeNull();
  });

  it('rejects an unparseable interval with an actionable message', () => {
    expect(() => parseRefresh('10 minutes' as never)).toThrow(/Use e\.g\./);
  });
});

describe('auditEnv', () => {
  it('reports which component is missing which variable', () => {
    const report = auditEnv([component('a', { required: ['A_KEY'] }), component('b', { required: ['B_KEY'] })], {
      A_KEY: 'set',
    });
    expect(report.missingByComponent).toEqual({ b: ['B_KEY'] });
  });

  it('treats an empty string as unset, because a blank .env line is a mistake', () => {
    const report = auditEnv([component('a', { required: ['A_KEY'] })], { A_KEY: '   ' });
    expect(report.missingByComponent.a).toEqual(['A_KEY']);
  });

  it('never blocks a component on an optional variable', () => {
    const report = auditEnv([component('a', { optional: ['A_KEY'] })], {});
    expect(report.missingByComponent).toEqual({});
    expect(report.declared.has('A_KEY')).toBe(true);
  });

  it('collects every declared variable, which is what generates .env.example', () => {
    const report = auditEnv([component('a', { required: ['R'], optional: ['O'] })], { R: 'x' });
    expect([...report.declared].sort()).toEqual(['O', 'R']);
  });
});

describe('scopedEnv', () => {
  it('reads a declared variable', () => {
    const { env } = scopedEnv(component('a', { optional: ['A_KEY'] }), { A_KEY: 'value' });
    expect(env('A_KEY')).toBe('value');
  });

  it('refuses an undeclared variable, so a manifest cannot lie about what it reads', () => {
    const { env } = scopedEnv(component('a', { optional: ['A_KEY'] }), { OTHER: 'value' });
    expect(() => env('OTHER')).toThrow(/undeclared environment variable/);
  });

  it('names the component and the fix in the error', () => {
    const { env } = scopedEnv(component('weather', {}), {});
    expect(() => env('SECRET')).toThrow(/components\/weather\/manifest\.ts/);
  });

  it('requireEnv explains what to set rather than returning undefined', () => {
    const { requireEnv } = scopedEnv(component('a', { required: ['A_KEY'] }), {});
    expect(() => requireEnv('A_KEY')).toThrow(/requires environment variable "A_KEY"/);
  });
});

describe('loadRegistry', () => {
  it('discovers every component in the repository', async () => {
    const { components, problems } = await loadRegistry();
    expect(problems).toEqual([]);
    // Adding a folder under components/ is the entire installation step, so this
    // asserts discovery works rather than pinning an exact list.
    expect(components.length).toBeGreaterThanOrEqual(8);
    expect(components.map((c) => c.definition.id)).toContain('weather-yr');
  });

  it('gives every component a unique id matching its folder', async () => {
    const { components } = await loadRegistry();
    const ids = components.map((c) => c.definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports a missing directory instead of throwing', async () => {
    const { components, problems } = await loadRegistry('/nonexistent/components/');
    expect(components).toEqual([]);
    expect(problems[0]?.error).toMatch(/not found/);
  });
});

describe('publicConfigSchema', () => {
  it('fills in sensible defaults for an empty config', () => {
    const config = publicConfigSchema.parse({});
    expect(config.timeZone).toBe('Europe/Oslo');
    expect(config.display.hideCursor).toBe(true);
    expect(config.layout).toEqual({});
  });

  it('rejects a layout area that does not exist in the grid', () => {
    const result = publicConfigSchema.safeParse({ layout: { clock: { area: 'middle' } } });
    expect(result.success).toBe(false);
  });

  it('accepts every real grid area', () => {
    for (const area of ['left', 'center', 'right', 'bottom']) {
      expect(publicConfigSchema.safeParse({ layout: { clock: { area } } }).success).toBe(true);
    }
  });

  it('parses the shipped example config', async () => {
    const example = await import('../../config/public.example.json', { with: { type: 'json' } });
    const result = publicConfigSchema.safeParse(example.default);
    expect(result.success).toBe(true);
  });
});
