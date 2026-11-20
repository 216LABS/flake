import { createHash } from 'node:crypto';
import { cached_lookup, eq, serviceDb } from '@flake/db';
import { log } from './log';
import { getProviders } from './providers';

type Point = { lat: number; lon: number };
export type LegMinutes = (a: Point, b: Point) => number | null;

/** Lots don't move, so road times between the same points stay good for a month. */
const KEEP_MS = 30 * 86_400_000;
const at = (p: Point) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/**
 * Road driving minutes between these points for Suggest order and re-plan (issue 65), from the cache or one router
 * call. Any failure, a missing key, an over-quota answer, or too many points gives straight-line estimates instead,
 * and `source` says which the plan used. Never throws.
 */
export async function roadTimes(points: Point[]): Promise<{ legMinutes: LegMinutes | null; source: 'road' | 'estimate'; label: string }> {
  const estimate = { legMinutes: null, source: 'estimate' as const, label: 'Drive times are estimates from distance, not live traffic.' };
  const keys = [...new Set(points.map(at))].sort();
  if (keys.length < 2) return estimate;
  try {
    const { router } = await getProviders();
    // Over one call's limit, a block at a time (issue 194), up to 3 blocks a side: 9 calls, cached for a month.
    const blocks = Math.ceil(keys.length / Math.max(1, router.maxPoints));
    if (!router.maxPoints || (keys.length > router.maxPoints && (!router.block || blocks > 3))) return { ...estimate, label: `Drive times are estimates from distance: ${keys.length} lots is more than road times cover at once.` };
    const cacheKey = `road:${createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 40)}`;
    const db = serviceDb();
    const [hit] = await db.select().from(cached_lookup).where(eq(cached_lookup.key, cacheKey));
    let matrix = hit && Date.now() - Date.parse(hit.fetched_at) < KEEP_MS ? (hit.value as { minutes: (number | null)[][] }).minutes : null;
    if (!matrix) {
      const pts = keys.map((k) => ({ lat: Number(k.split(',')[0]), lon: Number(k.split(',')[1]) }));
      if (keys.length <= router.maxPoints) {
        matrix = await router.minutes(pts);
      } else {
        const size = router.maxPoints;
        const parts = Array.from({ length: blocks }, (_, b) => pts.slice(b * size, (b + 1) * size));
        const full: (number | null)[][] = pts.map(() => pts.map(() => null));
        for (let a = 0; a < blocks; a++) {
          for (let b = 0; b < blocks; b++) {
            const m = await router.block!(parts[a]!, parts[b]!);
            if (!m) return estimate;
            m.forEach((row, i) => row.forEach((v, j) => { full[a * size + i]![b * size + j] = v; }));
          }
        }
        matrix = full;
      }
      if (!matrix) return estimate;
      await db.insert(cached_lookup).values({ key: cacheKey, value: { minutes: matrix } }).onConflictDoUpdate({ target: cached_lookup.key, set: { value: { minutes: matrix }, fetched_at: new Date().toISOString() } });
    }
    const index = new Map(keys.map((k, i) => [k, i]));
    const m = matrix;
    const legMinutes: LegMinutes = (a, b) => {
      const i = index.get(at(a));
      const j = index.get(at(b));
      return i === undefined || j === undefined ? null : (m[i]?.[j] ?? null);
    };
    return { legMinutes, source: 'road', label: `Drive times are ${router.source}, not live traffic.` };
  } catch (err) {
    log.error('road times unavailable, using estimates', err);
    return estimate;
  }
}
