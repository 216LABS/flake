import { describe, expect, it } from 'vitest';
import { LiveRouteMatrix, MockRouteMatrix, noRouter } from '../src/index';

describe('road times (issue 65)', () => {
  it('asks OpenRouteService for a driving matrix with the key, lon before lat, and turns seconds into minutes', async () => {
    let sent: { url: string; auth: string | null; body: any } | null = null;
    const ors = new LiveRouteMatrix('test-key', (async (url: string, init: any) => {
      sent = { url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ durations: [[0, 600], [660, null]] }));
    }) as typeof fetch);
    const m = await ors.minutes([{ lat: 41.48, lon: -81.8 }, { lat: 41.49, lon: -81.7 }]);
    expect(sent!.url).toContain('/v2/matrix/driving-car');
    expect(sent!.auth).toBe('test-key');
    expect(sent!.body.locations).toEqual([[-81.8, 41.48], [-81.7, 41.49]]);
    expect(m).toEqual([[0, 10], [11, null]]);
  });
  it('fails loudly on an error or a quota answer, so the caller falls back to estimates', async () => {
    const limited = new LiveRouteMatrix('k', (async () => new Response('{}', { status: 429 })) as typeof fetch);
    await expect(limited.minutes([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).rejects.toThrow('OpenRouteService 429');
  });
  it('more points than one call takes means no road times, not a partial matrix', async () => {
    const ors = new LiveRouteMatrix('k', (async () => { throw new Error('should not be called'); }) as typeof fetch);
    expect(await ors.minutes(Array.from({ length: 51 }, (_, i) => ({ lat: 41 + i / 100, lon: -81 })))).toBeNull();
  });
  it('without a key there are no road times', async () => {
    expect(await noRouter().minutes([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBeNull();
    expect((await new MockRouteMatrix().minutes([{ lat: 41, lon: -81 }, { lat: 41.1, lon: -81 }]))![0]![1]).toBeGreaterThan(0);
  });
});
