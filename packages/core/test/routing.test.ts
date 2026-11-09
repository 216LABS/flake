import { describe, expect, it } from 'vitest';
import { compareRoute, driveMinutes, evaluateRoute, replanFrom, serviceMinutes, suggestRoute, type RouteSite } from '../src/routing';

// A straight east-west street in Lakewood, about 0.5 miles between neighbors.
const at = (id: string, x: number, extra: Partial<RouteSite> = {}): RouteSite => ({ id, lat: 41.48, lon: -81.8 + x * 0.0096, priority: 3, sqft: 40000, ...extra });
const ids = (r: { id: string }[]) => r.map((s) => s.id);

describe('route ordering', () => {
  it('estimates lot time and storm driving', () => {
    expect(serviceMinutes(40000)).toBe(25);
    expect(serviceMinutes(300000)).toBe(90);
    expect(serviceMinutes(null)).toBe(20);
    expect(serviceMinutes(0)).toBe(20);
    const d = driveMinutes(at('a', 0), at('b', 10));
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(17);
  });

  it('untangles a zigzag into one sweep down the street', () => {
    const zig = [at('a', 0), at('d', 3), at('b', 1), at('e', 4), at('c', 2)];
    const best = ids(suggestRoute(zig));
    expect([['a', 'b', 'c', 'd', 'e'], ['e', 'd', 'c', 'b', 'a']]).toContainEqual(best);
    const r = compareRoute(zig);
    expect(r.changed).toBe(true);
    expect(r.suggested.drive_min).toBeLessThan(r.current.drive_min);
  });

  it('does priority 1 first even when it is out of the way', () => {
    const sites = [at('near1', 0), at('near2', 1), at('far', 8, { priority: 1 })];
    expect(ids(suggestRoute(sites))[0]).toBe('far');
    expect(ids(suggestRoute(sites.slice(0, 2).reverse().concat(sites[2]!)))[0]).toBe('far');
  });

  it('keeps the first stop when asked', () => {
    const sites = [at('yard-side', 4), at('a', 0), at('c', 2), at('b', 1)];
    const best = ids(suggestRoute(sites, { keepFirst: true }));
    expect(best).toEqual(['yard-side', 'c', 'b', 'a']);
    expect(ids(suggestRoute(sites.slice(0, 2), { keepFirst: true }))).toEqual(['yard-side', 'a']);
    expect(ids(suggestRoute([at('x', 0), at('y', 1, { priority: 1 })]))).toEqual(['y', 'x']);
  });

  it('gives up a little driving to make an open-by deadline', () => {
    // b must be done by 05:00. Starting at 04:00 from a and sweeping a, c, d first would miss it.
    const sites = [at('a', 0), at('c', 1), at('d', 2), at('b', 6, { open_by: '05:00' })];
    const plan = evaluateRoute(suggestRoute(sites, { start: '04:00' }), { start: '04:00' });
    expect(plan.late).toBe(0);
    expect(plan.stops.find((s) => s.id === 'b')!.late).toBe(false);
    const swept = evaluateRoute(sites, { start: '04:00' });
    expect(swept.late).toBe(1);
  });

  it('reports times on the clock, past midnight and with a bad start', () => {
    const p = evaluateRoute([at('a', 0, { open_by: '06:00' }), at('b', 1, { open_by: 'whenever' })], { start: '23:30' });
    expect(p.stops[0]).toMatchObject({ arrive: '23:30', finish: '23:55', drive_min: 0, service_min: 25, late: false });
    expect(p.stops[1]!.arrive).toBe('23:57');
    expect(p.total_min).toBe(52);
    expect(evaluateRoute([at('a', 0)], { start: 'soon' }).stops[0]!.arrive).toBe('04:00');
    expect(evaluateRoute([]).drive_min).toBe(0);
  });

  it('leaves a route alone when it is already as good', () => {
    const line = [at('a', 0), at('b', 1), at('c', 2), at('d', 3)];
    const r = compareRoute(line);
    expect(r.changed).toBe(false);
    expect(r.suggested).toEqual(r.current);
  });

  it('handles a bigger route quickly', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, lat: 41.4 + ((i * 37) % 60) * 0.002, lon: -81.8 + ((i * 53) % 60) * 0.003, priority: 1 + (i % 3), sqft: 20000 + i * 1000 }));
    const t = Date.now();
    const r = compareRoute(many);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.suggested.drive_min).toBeLessThan(r.current.drive_min);
    expect(new Set(r.suggested.stops.map((s) => s.id)).size).toBe(60);
  });
});

describe('route ordering, asked twice', () => {
  it('gives the same answer the second time', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, lat: 41.4 + ((i * 37) % 30) * 0.003, lon: -81.8 + ((i * 53) % 30) * 0.004, priority: 1 + (i % 2), sqft: 30000, open_by: i % 7 === 0 ? '06:30' : null }));
    const once = suggestRoute(many);
    expect(compareRoute(once).changed).toBe(false);
    const kept = suggestRoute(many, { keepFirst: true });
    expect(kept[0]!.id).toBe('s0');
    expect(compareRoute(kept, { keepFirst: true }).changed).toBe(false);
  });
});

describe('re-planning mid-storm from the truck', () => {
  it('starts from where the truck is and leaves its own position out of the list', () => {
    const left = [at('far', 6), at('near', 1), at('mid', 3)];
    const r = replanFrom({ lat: 41.48, lon: -81.8 }, left, { start: '05:00' });
    expect(r.suggested.stops.map((s) => s.id)).toEqual(['near', 'mid', 'far']);
    expect(r.changed).toBe(true);
    expect(r.suggested.stops[0]!.arrive).not.toBe('05:00');
    expect(replanFrom({ lat: 41.48, lon: -81.8 }, [at('a', 1), at('b', 2), at('c', 3)]).changed).toBe(false);
  });
});
