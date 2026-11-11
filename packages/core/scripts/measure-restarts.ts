/**
 * Issue 67: do randomized restarts pay for themselves on 30 to 80 stop routes? Same seeded routes as
 * compare-routing.ts. Run: pnpm --filter @flake/core exec tsx scripts/measure-restarts.ts
 */
import { evaluateRoute, suggestRoute, type RouteSite } from '../src/routing';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function route(n: number, seed: number): RouteSite[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const priority = r() < 0.25 ? 1 : r() < 0.6 ? 2 : 3;
    return { id: `s${i}`, lat: 41.44 + r() * 0.06, lon: -81.86 + r() * 0.12, priority, open_by: priority === 1 && r() < 0.7 ? ['05:30', '06:00', '06:30', '07:00'][Math.floor(r() * 4)]! : null, sqft: r() < 0.6 ? 3000 + Math.floor(r() * 60000) : null };
  });
}
const cost = (o: RouteSite[]) => { const p = evaluateRoute(o); return { drive: p.drive_min, late: p.late }; };

console.log('stops | restarts | mean drive min | mean late | mean ms | routes improved vs 0');
for (const n of [30, 50, 80]) {
  const base = new Map<number, number>();
  for (const k of [0, 5, 10]) {
    let drive = 0, late = 0, ms = 0, improved = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const sites = route(n, seed * 104729 + n);
      const t = performance.now();
      const c = cost(suggestRoute(sites, { restarts: k }));
      ms += performance.now() - t;
      drive += c.drive; late += c.late;
      const score = c.drive + c.late * 1000;
      if (k === 0) base.set(seed, score); else if (score < base.get(seed)! - 0.5) improved++;
    }
    console.log([n, k, (drive / 8).toFixed(1), (late / 8).toFixed(2), Math.round(ms / 8), k ? `${improved}/8` : '-'].join(' | '));
  }
}
