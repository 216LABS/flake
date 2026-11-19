import { describe, expect, it } from 'vitest';
import { planFleet } from '../src/fleet';
import { routeCost, type RouteSite } from '../src/routing';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function lots(n: number, seed: number, tiers = true): RouteSite[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ id: `s${String(i).padStart(3, '0')}`, lat: 41.42 + r() * 0.1, lon: -81.9 + r() * 0.2, priority: tiers ? (r() < 0.2 ? 1 : 2) : 1, sqft: null }));
}
const yard = { lat: 41.47, lon: -81.8 };

describe('issue 68: plan all routes', () => {
  it('splits 60 lots on one truck across 3, balancing the minutes', () => {
    const sites = lots(60, 7);
    const out = planFleet(sites, [{ id: 'a', current: sites.map((s) => s.id) }, { id: 'b', current: [] }, { id: 'c', current: [] }], { yard, budgetMs: 4000 });
    expect(out.changed).toBe(true);
    const all = out.routes.flatMap((r) => r.site_ids);
    expect(all.sort()).toEqual(sites.map((s) => s.id).sort());
    // Every truck gets work, and the longest day is well under the one-truck day.
    for (const r of out.routes) expect(r.site_ids.length).toBeGreaterThan(5);
    expect(out.after.longest_min).toBeLessThan(out.before.longest_min * 0.5);
    const days = out.routes.map((r) => r.plan.total_min);
    expect(Math.max(...days) - Math.min(...days)).toBeLessThan(Math.max(...days) * 0.35);
    expect(out.moved).toBe(out.routes[1]!.site_ids.length + out.routes[2]!.site_ids.length);
  }, 30_000);

  it('keeps priority tiers in order on every truck', () => {
    const sites = lots(40, 3);
    const half = sites.map((s) => s.id);
    const out = planFleet(sites, [{ id: 'a', current: half.slice(0, 20) }, { id: 'b', current: half.slice(20) }], { yard, budgetMs: 3000 });
    const pr = new Map(sites.map((s) => [s.id, s.priority]));
    for (const r of out.routes) {
      const p = r.site_ids.map((id) => pr.get(id)!);
      expect(p).toEqual([...p].sort((x, y) => x - y));
    }
  }, 30_000);

  it('is never worse than the routes as they are, and gives them back when it cannot beat them', () => {
    // Two tight clusters far apart, each already on its own good route.
    const west = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, lat: 41.48, lon: -81.95 + i * 0.002, priority: 1, sqft: null }));
    const east = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, lat: 41.48, lon: -81.55 + i * 0.002, priority: 1, sqft: null }));
    const trucks = [{ id: 'w', current: west.map((s) => s.id) }, { id: 'e', current: east.map((s) => s.id) }];
    const out = planFleet([...west, ...east], trucks, { budgetMs: 2000 });
    expect(out.after.drive_min + out.after.longest_min).toBeLessThanOrEqual(out.before.drive_min + out.before.longest_min);
    expect(out.routes.find((r) => r.id === 'w')!.site_ids.every((id) => id.startsWith('w'))).toBe(true);
    expect(out.moved).toBe(0);
  });

  it('keeps lots on the route that already has most of them', () => {
    const sites = lots(30, 11, false);
    const sorted = [...sites].sort((a, b) => a.lon - b.lon).map((s) => s.id);
    // Route "east" holds the east half, "west" the west half, but listed the other way round.
    const out = planFleet(sites, [{ id: 'east', current: sorted.slice(15) }, { id: 'west', current: sorted.slice(0, 15) }], { budgetMs: 2000 });
    const east = new Set(sorted.slice(15));
    const kept = out.routes[0]!.site_ids.filter((id) => east.has(id)).length;
    expect(kept).toBeGreaterThan(out.routes[0]!.site_ids.length / 2);
  });

  it('places lots that are on no route yet', () => {
    const sites = lots(20, 5);
    const out = planFleet(sites, [{ id: 'a', current: sites.slice(0, 8).map((s) => s.id) }, { id: 'b', current: sites.slice(8, 14).map((s) => s.id) }], { budgetMs: 2000 });
    expect(out.routes.flatMap((r) => r.site_ids).sort()).toEqual(sites.map((s) => s.id).sort());
    expect(out.after.stops).toBe(20);
    expect(out.before.stops).toBe(14);
  });

  it('prices each truck with its own yard setting', () => {
    const sites = lots(10, 2);
    const ids = sites.map((s) => s.id);
    const out = planFleet(sites, [{ id: 'a', current: ids, yard_trip: false }], { yard, budgetMs: 1000 });
    const order = out.routes[0]!.site_ids.map((id) => sites.find((s) => s.id === id)!);
    expect(out.routes[0]!.plan.drive_min).toBe(routeCost(order, {}).plan.drive_min);
  });

  it('gives the same plan twice', () => {
    const sites = lots(25, 9);
    const trucks = [{ id: 'a', current: sites.map((s) => s.id) }, { id: 'b', current: [] }];
    const a = planFleet(sites, trucks, { budgetMs: 60_000 });
    const b = planFleet(sites, trucks, { budgetMs: 60_000 });
    expect(a.routes.map((r) => r.site_ids)).toEqual(b.routes.map((r) => r.site_ids));
  }, 60_000);
});
