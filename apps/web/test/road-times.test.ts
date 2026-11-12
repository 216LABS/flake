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
    expect((await roadTimes(pts(60))).source).toBe('estimate');
  });
});
