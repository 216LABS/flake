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

describe('issue 194: plan all routes keeps routes people know', () => {
  // Three neighborhoods, one route each, a little uneven: the kind of company Flip has.
  const hood = (prefix: string, n: number, lat: number, lon: number, seed: number): RouteSite[] => {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, lat: lat + r() * 0.012, lon: lon + r() * 0.012, priority: 2, sqft: null }));
  };
  const west = hood('w', 11, 41.48, -81.82, 1);
  const east = hood('e', 8, 41.48, -81.78, 2);
  const river = hood('r', 9, 41.46, -81.86, 3);
  const sites = [...west, ...east, ...river];
  const trucks = [{ id: 'west', current: west.map((s) => s.id) }, { id: 'east', current: east.map((s) => s.id) }, { id: 'river', current: river.map((s) => s.id) }];

  it('in keep mode moves only a few lots, each saving its keep, while a fresh start moves more', () => {
    const keep = planFleet(sites, trucks, { yard, budgetMs: 1500, mode: 'keep' });
    const fresh = planFleet(sites, trucks, { yard, budgetMs: 1500, mode: 'fresh' });
    const routedMoves = (p: typeof keep) => p.moves.filter((m) => m.from !== null).length;
    expect(routedMoves(keep)).toBeLessThanOrEqual(Math.floor(sites.length * 0.2));
    expect(routedMoves(keep)).toBeLessThanOrEqual(routedMoves(fresh));
    // Each route keeps most of its own neighborhood.
    for (const [t, hoodLots] of [[0, west], [1, east], [2, river]] as const) {
      const kept = keep.routes[t]!.site_ids.filter((id) => hoodLots.some((s) => s.id === id)).length;
      expect(kept).toBeGreaterThanOrEqual(Math.ceil(hoodLots.length * 0.75));
    }
    expect(keep.mode).toBe('keep');
  });

  it('with a high churn cost nothing moves at all', () => {
    const p = planFleet(sites, trucks, { yard, budgetMs: 800, mode: 'keep', churnMinutes: 10_000 });
    expect(p.moves.filter((m) => m.from !== null)).toEqual([]);
  });

  it('add-only puts lots on no route onto the nearest route and moves no routed lot', () => {
    const loose = hood('x', 3, 41.481, -81.781, 9); // next to the east lots
    const p = planFleet([...sites, ...loose], trucks, { yard, budgetMs: 800, mode: 'add_only' });
    expect(p.moves.every((m) => m.from === null)).toBe(true);
    expect(p.moves.map((m) => m.site_id).sort()).toEqual(loose.map((s) => s.id).sort());
    for (const t of [0, 1, 2]) for (const id of trucks[t]!.current) expect(p.routes[t]!.site_ids).toContain(id);
    expect(p.moves.every((m) => m.to === 'east')).toBe(true);
  });

  it('says how much closer a moved lot is to its new neighbors', () => {
    // One west lot sitting in the middle of the east lots.
    const stray = { id: 'wstray', lat: 41.486, lon: -81.774, priority: 2, sqft: null };
    const p = planFleet([...sites, stray], [{ ...trucks[0]!, current: [...trucks[0]!.current, 'wstray'] }, trucks[1]!, trucks[2]!], { yard, budgetMs: 1500, mode: 'keep' });
    const m = p.moves.find((x) => x.site_id === 'wstray');
    expect(m).toMatchObject({ from: 'west', to: 'east' });
    expect(m!.closer_min).toBeGreaterThan(0);
  });
});
