import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@flake/db';
import { MockRouteMatrix } from '@flake/providers';
import { roadTimes } from '@/lib/road-times';

afterAll(() => closeDb());

const pts = (n: number, seed = Math.random()) => Array.from({ length: n }, (_, i) => ({ lat: 41.47 + i * 0.003 + seed / 1000, lon: -81.8 - i * 0.002 }));

describe('issue 65: road times for planning', () => {
  it('asks the router once, then answers from the cache, with a label that says so', async () => {
    const spy = vi.spyOn(MockRouteMatrix.prototype, 'minutes');
    const p = pts(5);
    const first = await roadTimes(p);
    expect(first.source).toBe('road');
    expect(first.label).toContain('mock road times');
    expect(first.legMinutes!(p[0]!, p[1]!)).toBeGreaterThan(0);
    // The same lots in another order hit the cache.
    const again = await roadTimes([...p].reverse());
    expect(again.legMinutes!(p[1]!, p[0]!)).toBe(first.legMinutes!(p[1]!, p[0]!));
    expect(spy).toHaveBeenCalledTimes(1);
    // A point it wasn't asked about falls back to the estimate.
    expect(first.legMinutes!(p[0]!, { lat: 40, lon: -80 })).toBeNull();
    spy.mockRestore();
  });
  it('a router failure or too many points plans on estimates and says so', async () => {
    const spy = vi.spyOn(MockRouteMatrix.prototype, 'minutes').mockRejectedValue(new Error('OpenRouteService 429'));
    const down = await roadTimes(pts(4));
    expect(down).toMatchObject({ legMinutes: null, source: 'estimate' });
    expect(down.label).toContain('estimates from distance');
    spy.mockRestore();
    // More than three blocks' worth is still an estimate, and the label says why.
    const huge = await roadTimes(pts(160));
    expect(huge.source).toBe('estimate');
    expect(huge.label).toContain('160 lots');
  });
  it('over 50 lots, road times come a block at a time (issue 194)', async () => {
    const spy = vi.spyOn(MockRouteMatrix.prototype, 'block');
    const p = pts(80);
    const out = await roadTimes(p);
    expect(out.source).toBe('road');
    // Two blocks a side: four calls, and any two lots have a time, across blocks too.
    expect(spy).toHaveBeenCalledTimes(4);
    expect(out.legMinutes!(p[2]!, p[75]!)).toBeGreaterThan(0);
    expect(out.legMinutes!(p[75]!, p[2]!)).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
