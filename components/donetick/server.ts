import type { HandlerContext } from '../../src/shared/component.js';

export interface DonetickConfig {
  maxChores: number;
  hideCompleted: boolean;
  lookaheadDays: number;
}

export interface Chore {
  id: string;
  name: string;
  /** ISO instant, or null for a chore with no due date. */
  dueDate: string | null;
  assignee?: string;
  priority?: number;
  labels: string[];
  /** overdue | today | tomorrow | upcoming | someday */
  bucket: ChoreBucket;
  daysUntil: number | null;
}

export type ChoreBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'someday';

export interface DonetickData {
  chores: Chore[];
  counts: Record<ChoreBucket, number>;
}

/**
 * Donetick's response envelope and field names have varied across releases, and it
 * is self-hosted so people run whatever version they installed. Rather than pinning
 * one shape, accept the ones seen in the wild and fail loudly only if none matches.
 */
interface RawChore {
  id?: number | string;
  name?: string;
  title?: string;
  nextDueDate?: string | null;
  dueDate?: string | null;
  due_date?: string | null;
  assignedTo?: string | number | null;
  assignee?: string | null;
  priority?: number;
  isActive?: boolean;
  is_active?: boolean;
  status?: string | number;
  labels?: (string | { name?: string })[] | null;
}

export function unwrap(payload: unknown): RawChore[] {
  if (Array.isArray(payload)) return payload as RawChore[];
  if (payload && typeof payload === 'object') {
    for (const key of ['res', 'data', 'items', 'chores', 'result']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as RawChore[];
    }
  }
  throw new Error('Donetick returned an unrecognised response shape; expected an array of chores');
}

/** Local-midnight difference, so "tomorrow" means the next calendar day, not 24 hours. */
export function daysBetween(from: Date, to: Date, timeZone: string): number {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone });
  const a = new Date(`${key(from)}T00:00:00Z`).getTime();
  const b = new Date(`${key(to)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function bucketFor(daysUntil: number | null, due: Date | null, now: Date): ChoreBucket {
  if (daysUntil === null || due === null) return 'someday';
  if (daysUntil < 0 || (daysUntil === 0 && due < now)) return 'overdue';
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return 'upcoming';
}

const BUCKET_ORDER: ChoreBucket[] = ['overdue', 'today', 'tomorrow', 'upcoming', 'someday'];

export function normalise(raw: RawChore[], config: DonetickConfig, timeZone: string, now: Date): DonetickData {
  const chores: Chore[] = [];

  for (const item of raw) {
    const active = item.isActive ?? item.is_active;
    if (config.hideCompleted && active === false) continue;

    const rawDue = item.nextDueDate ?? item.dueDate ?? item.due_date ?? null;
    const due = rawDue ? new Date(rawDue) : null;
    const valid = due && !Number.isNaN(due.getTime()) ? due : null;
    const daysUntil = valid ? daysBetween(now, valid, timeZone) : null;

    // A chore due in three months is not useful on a wall display.
    if (daysUntil !== null && daysUntil > config.lookaheadDays) continue;

    chores.push({
      id: String(item.id ?? crypto.randomUUID()),
      name: item.name ?? item.title ?? 'Untitled chore',
      dueDate: valid?.toISOString() ?? null,
      assignee: typeof item.assignee === 'string' ? item.assignee : item.assignedTo != null ? String(item.assignedTo) : undefined,
      priority: item.priority,
      labels: (item.labels ?? [])
        .map((l) => (typeof l === 'string' ? l : l?.name))
        .filter((l): l is string => Boolean(l)),
      bucket: bucketFor(daysUntil, valid, now),
      daysUntil,
    });
  }

  // Overdue first, then by due date — the order someone glancing at the board needs.
  chores.sort((a, b) => {
    const byBucket = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (byBucket !== 0) return byBucket;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.name.localeCompare(b.name);
  });

  const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ChoreBucket, number>;
  for (const chore of chores) counts[chore.bucket] += 1;

  return { chores: chores.slice(0, config.maxChores), counts };
}

export async function fetchChores(ctx: HandlerContext<DonetickConfig>): Promise<DonetickData> {
  const baseUrl = ctx.requireEnv('DONETICK_BASE_URL').replace(/\/+$/, '');
  const token = ctx.requireEnv('DONETICK_TOKEN');

  const res = await ctx.fetch(`${baseUrl}/api/v1/chores`, {
    // Donetick access tokens go in `secretkey`, not an Authorization header.
    headers: { secretkey: token, Accept: 'application/json' },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Donetick rejected DONETICK_TOKEN (${res.status}). Create a new access token in Donetick settings.`);
  }
  if (!res.ok) throw new Error(`Donetick returned ${res.status} ${res.statusText}`);

  return normalise(unwrap(await res.json()), ctx.config, ctx.timeZone, new Date());
}
