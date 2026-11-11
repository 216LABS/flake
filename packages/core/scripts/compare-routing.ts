/**
 * Suggest order, before and after Or-opt (issue 42): the demo routes, then seeded random routes of 10 to 200 stops in
 * the Lakewood area with priority tiers and some open-by deadlines. Deterministic, so the numbers in
 * docs/ROUTING_DESIGN.md can be reproduced: pnpm --filter @flake/core exec tsx scripts/compare-routing.ts
 */
import { SEED_SITES } from '../../db/src/seed-data';
import { evaluateRoute, suggestRoute, type RouteSite } from '../src/routing';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomRoute(n: number, seed: number): RouteSite[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const priority = r() < 0.25 ? 1 : r() < 0.6 ? 2 : 3;
    return {
      id: `s${i}`,
      lat: 41.44 + r() * 0.06,
      lon: -81.86 + r() * 0.12,
      priority,
      open_by: priority === 1 && r() < 0.7 ? ['05:30', '06:00', '06:30', '07:00'][Math.floor(r() * 4)]! : null,
      sqft: r() < 0.6 ? 3000 + Math.floor(r() * 60000) : null,
    };
  });
}

function row(name: string, sites: RouteSite[]) {
  const t0 = performance.now();
  const basic = evaluateRoute(suggestRoute(sites, { search: 'basic', budgetMs: 60_000 }));
  const t1 = performance.now();
  const full = evaluateRoute(suggestRoute(sites, { search: 'full' }));
  const t2 = performance.now();
  const entered = evaluateRoute(sites);
  console.log([name, sites.length, `${entered.drive_min} / ${entered.late}`, `${basic.drive_min} / ${basic.late}`, `${full.drive_min} / ${full.late}`, `${Math.round(t1 - t0)} / ${Math.round(t2 - t1)}`].join(' | '));
}

console.log('route | stops | as entered: drive min / late | basic | with Or-opt | ms basic / Or-opt');
for (const r of ['west', 'east', 'river'] as const) {
  const sites = SEED_SITES.filter((s) => s.route === r).map((s) => ({ id: s.key, lat: s.lat, lon: s.lon, priority: s.priority ?? 2, open_by: s.open_by ?? null, sqft: null }));
  row(`demo ${r}`, sites);
}
for (const n of [10, 30, 80, 200]) for (const seed of [1, 2, 3]) row(`random ${seed}`, randomRoute(n, seed * 7919 + n));
