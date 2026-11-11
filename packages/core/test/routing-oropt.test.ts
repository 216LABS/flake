import { describe, expect, it } from 'vitest';
import { evaluateRoute, suggestRoute, type RouteSite } from '../src/routing';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function route(n: number, seed: number): RouteSite[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const priority = r() < 0.25 ? 1 : r() < 0.6 ? 2 : 3;
    return { id: `s${i}`, lat: 41.44 + r() * 0.06, lon: -81.86 + r() * 0.12, priority, open_by: priority === 1 && r() < 0.7 ? '06:00' : null, sqft: null };
  });
}
const cost = (sites: RouteSite[]) => {
  const p = evaluateRoute(sites);
  return p.drive_min + p.late * 1000;
};

describe('issue 42: Or-opt in Suggest order', () => {
  it('is never worse than the basic search, and better on a real share of routes', () => {
    let better = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const sites = route(40, seed * 31);
      const basic = cost(suggestRoute(sites, { search: 'basic' }));
      const full = cost(suggestRoute(sites));
      expect(full).toBeLessThanOrEqual(basic);
      if (full < basic) better++;
    }
    // This is the part only Or-opt can do: with search 'basic' on both sides it would be 0.
    expect(better).toBeGreaterThan(0);
  });
  it('puts a stray pair of stops back in line', () => {
    // A line of lots east to west, with a pair from the far west end stuck at the start, the wrong way round.
    const line = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, lat: 41.48, lon: -81.75 - i * 0.01, priority: 1, sqft: null }));
    const scrambled = [line[0]!, line[7]!, line[6]!, ...line.slice(1, 6)];
    const out = suggestRoute(scrambled, { keepFirst: true }).map((s) => s.id);
    expect(out).toEqual(line.map((s) => s.id));
  });
  it('keeps priority tiers and every stop', () => {
    const sites = route(30, 99);
    const out = suggestRoute(sites);
    expect(new Set(out.map((s) => s.id))).toEqual(new Set(sites.map((s) => s.id)));
    expect(out.every((s, i) => i === 0 || out[i - 1]!.priority <= s.priority)).toBe(true);
  });
  it('stops at its time budget on a very long route and still returns a full order', () => {
    const sites = route(200, 7);
    const t = Date.now();
    const out = suggestRoute(sites, { budgetMs: 300 });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(out).toHaveLength(200);
    expect(cost(out)).toBeLessThan(cost(sites));
  });
});
