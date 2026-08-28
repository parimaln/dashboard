import type { HandlerContext } from '../../src/shared/component.js';

export interface MealieConfig {
  days: number;
  showImages: boolean;
}

export interface MealEntry {
  /** breakfast | lunch | dinner | side, as Mealie records it. */
  type: string;
  title: string;
  description?: string;
  /** Path on this server, never on Mealie — see the image proxy in the manifest. */
  imageUrl?: string;
}

export interface MealDay {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  entries: MealEntry[];
}

export interface MealieData {
  days: MealDay[];
}

interface MealieMealplan {
  date?: string;
  entryType?: string;
  title?: string;
  text?: string;
  recipe?: { id?: string; name?: string; slug?: string; description?: string } | null;
}

/**
 * Mealie moved meal plans from `/api/groups/mealplans` to `/api/households/mealplans`
 * in the v2 line. Rather than making the user configure which they run, try the
 * current path and fall back once, remembering the answer for subsequent refreshes.
 */
const MEALPLAN_PATHS = ['/api/households/mealplans', '/api/groups/mealplans'] as const;
let resolvedPath: string | null = null;

/** Exposed for tests, which exercise both server generations. */
export function resetMealiePathCache(): void {
  resolvedPath = null;
}

function toIsoDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone });
}

export function normalise(items: MealieMealplan[], dates: string[], baseImagePath: string): MealDay[] {
  const byDate = new Map<string, MealEntry[]>(dates.map((d) => [d, []]));

  for (const item of items) {
    if (!item.date) continue;
    // Mealie returns dates as YYYY-MM-DD already; guard against a full timestamp.
    const date = item.date.slice(0, 10);
    const bucket = byDate.get(date);
    if (!bucket) continue;

    // An entry is either a linked recipe or a free-text note; both are legitimate.
    const title = item.recipe?.name ?? item.title ?? item.text ?? 'Planned meal';
    bucket.push({
      type: item.entryType ?? 'dinner',
      title,
      description: item.recipe?.description ?? (item.recipe ? undefined : item.text) ?? undefined,
      imageUrl: item.recipe?.id ? `${baseImagePath}/${encodeURIComponent(item.recipe.id)}` : undefined,
    });
  }

  const order = ['breakfast', 'lunch', 'dinner', 'side'];
  for (const entries of byDate.values()) {
    entries.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  }

  return dates.map((date) => ({ date, entries: byDate.get(date) ?? [] }));
}

export async function fetchMealPlan(ctx: HandlerContext<MealieConfig>): Promise<MealieData> {
  const baseUrl = ctx.requireEnv('MEALIE_BASE_URL').replace(/\/+$/, '');
  const token = ctx.requireEnv('MEALIE_TOKEN');

  const today = new Date();
  const dates = Array.from({ length: ctx.config.days }, (_, i) =>
    toIsoDate(new Date(today.getTime() + i * 86_400_000), ctx.timeZone),
  );

  const query = `?start_date=${dates[0]}&end_date=${dates[dates.length - 1]}&perPage=100`;
  const candidates = resolvedPath ? [resolvedPath] : MEALPLAN_PATHS;

  let items: MealieMealplan[] | null = null;
  let lastError = '';

  for (const path of candidates) {
    const res = await ctx.fetch(`${baseUrl}${path}${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (res.status === 404) {
      lastError = `404 at ${path}`;
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Mealie rejected MEALIE_TOKEN (${res.status}). Regenerate it under your Mealie profile.`);
    }
    if (!res.ok) {
      lastError = `${res.status} ${res.statusText} at ${path}`;
      continue;
    }

    const json = (await res.json()) as { items?: MealieMealplan[] } | MealieMealplan[];
    items = Array.isArray(json) ? json : (json.items ?? []);
    if (resolvedPath !== path) {
      resolvedPath = path;
      ctx.log(`using Mealie meal-plan endpoint ${path}`);
    }
    break;
  }

  if (items === null) {
    // A stale cached path (after a Mealie upgrade) must not wedge the component.
    resolvedPath = null;
    throw new Error(`Mealie meal plan request failed: ${lastError || 'no endpoint responded'}`);
  }

  return { days: normalise(items, dates, '/img/mealie') };
}

/** Resolves `/img/mealie/<recipeId>` to the token-protected image on the Mealie server. */
export async function resolveImage(ctx: HandlerContext<MealieConfig>, ref: string) {
  const baseUrl = ctx.requireEnv('MEALIE_BASE_URL').replace(/\/+$/, '');
  const token = ctx.requireEnv('MEALIE_TOKEN');
  // Reject anything that is not a plain id so this cannot be walked into an SSRF.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ref)) throw new Error('invalid recipe id');
  return {
    url: `${baseUrl}/api/media/recipes/${ref}/images/min-original.webp`,
    headers: { Authorization: `Bearer ${token}` },
  };
}
