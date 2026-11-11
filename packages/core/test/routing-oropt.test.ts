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
      const basic = cost(suggestRoute(sites, { search: 'basic', restarts: 0 }));
      const full = cost(suggestRoute(sites, { restarts: 0 }));
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

describe('issue 67: restarts', () => {
  it('are never worse than none, and the same route gives the same answer twice', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const sites = route(35, seed * 977);
      const none = suggestRoute(sites, { restarts: 0 });
      const some = suggestRoute(sites, { restarts: 5 });
      expect(cost(some)).toBeLessThanOrEqual(cost(none));
      expect(suggestRoute(sites, { restarts: 5 }).map((s) => s.id)).toEqual(some.map((s) => s.id));
      expect(some.every((s, i) => i === 0 || some[i - 1]!.priority <= s.priority)).toBe(true);
    }
  });
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
    // Nearest-first would do the church lot (n1) second and wait; it goes last instead.
    const sites = [at(0), at(1, { not_before: '06:00' }), at(2), at(3), at(4)];
    const out = suggestRoute(sites, { start: '04:00', keepFirst: true }).map((s) => s.id);
    expect(out.at(-1)).toBe('n1');
    expect(evaluateRoute(suggestRoute(sites, { start: '04:00', keepFirst: true }), { start: '04:00' }).wait_min).toBeLessThan(evaluateRoute(sites, { start: '04:00' }).wait_min);
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
