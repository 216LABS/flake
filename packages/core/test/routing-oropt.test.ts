import { describe, expect, it } from 'vitest';
import { compareRoute, evaluateRoute, replanFrom, suggestRoute, type RouteSite } from '../src/routing';

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
      // Restarts are measured on their own (issue 67); this compares the search moves alone.
      // A big budget, so a slow machine gets the same answer, not one cut short.
      const basic = cost(suggestRoute(sites, { search: 'basic', restarts: 0, budgetMs: 60_000 }));
      const full = cost(suggestRoute(sites, { restarts: 0, budgetMs: 60_000 }));
      expect(full).toBeLessThanOrEqual(basic);
      if (full < basic) better++;
    }
    // This is the part only Or-opt can do: with search 'basic' on both sides it would be 0.
    expect(better).toBeGreaterThan(0);
  }, 60_000);
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

describe('issue 67: restarts', () => {
  // A big time budget, so the answer depends on the seed and not on how fast the machine is (CI is slower than a
  // laptop, and a budget cut short there could make "the same answer twice" differ).
  it('are never worse than none, and the same route gives the same answer twice', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const sites = route(35, seed * 977);
      const none = suggestRoute(sites, { restarts: 0, budgetMs: 60_000 });
      const some = suggestRoute(sites, { restarts: 5, budgetMs: 60_000 });
      expect(cost(some)).toBeLessThanOrEqual(cost(none));
      expect(suggestRoute(sites, { restarts: 5, budgetMs: 60_000 }).map((s) => s.id)).toEqual(some.map((s) => s.id));
      expect(some.every((s, i) => i === 0 || some[i - 1]!.priority <= s.priority)).toBe(true);
    }
  }, 60_000);
});

describe('issue 66: not before', () => {
  const at = (i: number, extra: Partial<RouteSite> = {}): RouteSite => ({ id: `n${i}`, lat: 41.48, lon: -81.80 - i * 0.01, priority: 1, sqft: null, ...extra });
  it('the truck waits for a lot that is not open yet, and the plan says how long', () => {
    const plan = evaluateRoute([at(0), at(1, { not_before: '05:00' })], { start: '04:00' });
    expect(plan.stops[1]).toMatchObject({ arrive: '05:00', wait_min: expect.any(Number) });
    expect(plan.stops[1]!.wait_min).toBeGreaterThan(30);
    expect(plan.wait_min).toBe(plan.stops[1]!.wait_min);
  });
  it('Suggest order does the other lots first instead of waiting', () => {
    // Nearest-first would do the church lot (n1) second and wait; it goes later, where the drive is shortest.
    const sites = [at(0), at(1, { not_before: '06:00' }), at(2), at(3), at(4)];
    const out = suggestRoute(sites, { start: '04:00', keepFirst: true }).map((s) => s.id);
    expect(out.indexOf('n1')).toBeGreaterThan(1);
    // Idle time, whether waited on site or taken as a break, goes down.
    const idle = (p: ReturnType<typeof evaluateRoute>) => p.wait_min + p.break_min;
    expect(idle(evaluateRoute(suggestRoute(sites, { start: '04:00', keepFirst: true }), { start: '04:00' }))).toBeLessThan(idle(evaluateRoute(sites, { start: '04:00' })));
  });
  it('a time earlier on the clock than the start means the next morning', () => {
    const plan = evaluateRoute([at(0), at(1, { not_before: '01:00' })], { start: '22:00' });
    expect(plan.stops[1]!.arrive).toBe('01:00');
  });
});

describe('issue 64: start and end at the yard', () => {
  // Six lots on a line running west, and a yard just east of the first one.
  const line = Array.from({ length: 6 }, (_, i) => ({ id: `y${i}`, lat: 41.48, lon: -81.80 - i * 0.01, priority: 1, sqft: null }));
  const yard = { lat: 41.48, lon: -81.79 };
  it('plans out from the yard and back, counts both drives, and never shows the yard as a stop', () => {
    // Scrambled in; a round trip along a line is the same either way round, so either direction is right.
    const scrambled = [line[3]!, line[0]!, line[5]!, line[1]!, line[4]!, line[2]!];
    const r = compareRoute(scrambled, { yard });
    const ids = r.suggested.stops.map((s) => s.id).join();
    expect([line.map((s) => s.id).join(), [...line].reverse().map((s) => s.id).join()]).toContain(ids);
    expect(r.suggested.stops.some((s) => s.id.startsWith('__'))).toBe(false);
    // Out to the first lot and back from the last: more driving than the lots alone.
    expect(r.suggested.drive_min).toBeGreaterThan(compareRoute(line).suggested.drive_min);
    expect(r.changed).toBe(true);
  });
  it('the first lot stays first after the yard when asked', () => {
    const r = compareRoute([line[3]!, ...line.filter((_, i) => i !== 3)], { yard, keepFirst: true });
    expect(r.suggested.stops[0]!.id).toBe('y3');
  });
  it('a mid-storm re-plan heads back to the yard at the end', () => {
    const truck = { lat: 41.48, lon: -81.85 };
    const home = replanFrom(truck, line.slice(0, 5), { endAt: yard });
    const free = replanFrom(truck, line.slice(0, 5));
    expect(home.suggested.stops).toHaveLength(5);
    expect(home.suggested.drive_min).toBeGreaterThanOrEqual(free.suggested.drive_min);
  });
});

describe('issue 65: road times', () => {
  it('a slow road between two lots changes the plan, and a missing pair falls back to the estimate', () => {
    // Four lots in a square; the road between a and c is a long way round (a river with one bridge, say).
    const pts = [{ id: 'a', lat: 41.48, lon: -81.80 }, { id: 'b', lat: 41.48, lon: -81.79 }, { id: 'c', lat: 41.49, lon: -81.80 }, { id: 'd', lat: 41.49, lon: -81.79 }].map((p) => ({ ...p, priority: 1, sqft: null }));
    const slow = (x: { lat: number; lon: number }, y: { lat: number; lon: number }) => {
      const ac = (p: { lat: number }, q: { lat: number }) => p.lat === 41.48 && q.lat === 41.49;
      const sameLon = x.lon === y.lon && x.lon === -81.80;
      return sameLon && (ac(x, y) || ac(y, x)) ? 60 : null;
    };
    const plain = evaluateRoute(['a', 'c', 'd', 'b'].map((id) => pts.find((p) => p.id === id)!));
    const road = evaluateRoute(['a', 'c', 'd', 'b'].map((id) => pts.find((p) => p.id === id)!), { legMinutes: slow });
    expect(road.drive_min).toBeGreaterThan(plain.drive_min + 50);
    const order = suggestRoute(pts, { legMinutes: slow, keepFirst: true, restarts: 0 }).map((s) => s.id);
    const i = order.indexOf('a');
    expect(order[i + 1]).not.toBe('c');
  });
});

describe('issue 72: a lot not open yet is planned when it opens, not waited for', () => {
  // The production case: the route's only priority 1 lot opens at 5:30 PM; the truck starts at 4 AM.
  const lot = (i: number, priority: number, extra: Partial<RouteSite> = {}): RouteSite => ({ id: `p${i}`, lat: 41.48 + (i % 3) * 0.004, lon: -81.80 - i * 0.004, priority, sqft: 20000, ...extra });
  const route = [lot(0, 2), lot(1, 1, { not_before: '17:30' }), lot(2, 2), lot(3, 3), lot(4, 2), lot(5, 3), lot(6, 3)];
  it('goes late in the route, and nobody waits for hours', () => {
    const r = compareRoute(route, { start: '04:00' });
    const ids = r.suggested.stops.map((s) => s.id);
    expect(ids[0]).not.toBe('p1');
    expect(ids.indexOf('p1')).toBe(ids.length - 1);
    // No stop has a truck sitting at a lot for an hour or more (issue 74): the gap is a break, not a wait.
    expect(Math.max(...r.suggested.stops.map((s) => s.wait_min))).toBeLessThan(60);
    const late = r.suggested.stops.at(-1)!;
    expect(late).toMatchObject({ arrive: '17:30', via_yard: false });
    expect(late.break_min).toBeGreaterThan(8 * 60);
    expect(r.suggested.work_min).toBeLessThan(4 * 60);
    expect(r.suggested.work_min).toBe(r.suggested.total_min - r.suggested.break_min);
    expect(new Set(ids)).toEqual(new Set(route.map((s) => s.id)));
  });
  it('a lot opening right after the start still comes early, as its priority asks', () => {
    const soon = route.map((s) => (s.id === 'p1' ? { ...s, not_before: '04:10' } : s));
    const ids = compareRoute(soon, { start: '04:00' }).suggested.stops.map((s) => s.id);
    expect(ids.indexOf('p1')).toBeLessThanOrEqual(1);
  });
  it('with the yard, the late lot still comes before the trip home', () => {
    const r = compareRoute(route, { start: '04:00', yard: { lat: 41.48, lon: -81.79 } });
    expect(r.suggested.stops.at(-1)!.id).toBe('p1');
    expect(r.suggested.stops.some((s) => s.id.startsWith('__'))).toBe(false);
  });
  it('with the yard, the truck goes back between runs and sets out in time, and that drive counts (issue 74)', () => {
    const yard = { lat: 41.48, lon: -81.79 };
    const r = compareRoute(route, { start: '04:00', yard });
    const late = r.suggested.stops.at(-1)!;
    expect(late).toMatchObject({ id: 'p1', arrive: '17:30', via_yard: true, wait_min: 0 });
    expect(late.break_min).toBeGreaterThan(8 * 60);
    // Sets out before 5:30 PM by the drive from the yard.
    expect(late.out_at! < '17:30').toBe(true);
    expect(late.drive_min).toBeGreaterThan(0);
    expect(r.suggested.work_min).toBeLessThan(4 * 60);
  });
  it('a short gap stays a wait at the lot, not a break', () => {
    const soon = route.map((s) => (s.id === 'p1' ? { ...s, not_before: '04:20' } : s));
    const p = evaluateRoute([soon[1]!, ...soon.filter((s) => s.id !== 'p1')].reverse(), { start: '04:00' });
    expect(p.break_min).toBe(0);
  });
});
