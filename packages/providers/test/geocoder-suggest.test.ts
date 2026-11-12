import { describe, expect, it } from 'vitest';
import { LiveGeocoder } from '../src/index';

/**
 * Issue 87, as production saw it: OpenStreetMap has Berea Rd but no house numbers on it, Census knows 12900 but not
 * 13000, and a number-only search finds places in other states.
 */
const fake = (async (url: string) => {
  const u = new URL(url);
  if (u.hostname.includes('census')) {
    const a = u.searchParams.get('address') ?? '';
    const known = /^12900 Berea Rd/i.test(a) || /^12950 Berea Rd/i.test(a);
    return new Response(JSON.stringify({ result: { addressMatches: known ? [{ matchedAddress: `${a.split(',')[0]!.toUpperCase()}, CLEVELAND, OH, 44111`, coordinates: { x: -81.79, y: 41.46 } }] : [] } }));
  }
  const q = u.searchParams.get('q') ?? '';
  const features = /^\d/.test(q)
    ? [{ geometry: { coordinates: [-83.0, 42.44] }, properties: { countrycode: 'US', housenumber: '13000', street: 'East 8 Mile Rd', city: 'Detroit', state: 'Michigan' } }]
    : [{ geometry: { coordinates: [-81.78, 41.46] }, properties: { countrycode: 'US', name: 'Berea Road', street: 'Berea Road', city: 'Cleveland', state: 'Ohio' } }];
  return new Response(JSON.stringify({ features }));
}) as unknown as typeof fetch;

const near = { lat: 41.47, lon: -81.8 };

describe('issue 87: yard suggestions for real Cleveland street numbers', () => {
  it('a full address Census knows comes back, even when OpenStreetMap has no house numbers', async () => {
    const hits = await new LiveGeocoder(fake).suggest('12900 Berea Rd, Cleveland, OH 44111', { near });
    expect(hits.map((h) => h.label)).toEqual(['12900 BEREA RD, CLEVELAND, OH, 44111']);
  });
  it('one Census does not know offers the numbers next door after a save, never Detroit', async () => {
    const plain = await new LiveGeocoder(fake).suggest('13000 Berea Rd, Cleveland, OH 44111', { near });
    expect(plain).toEqual([]);
    const expanded = await new LiveGeocoder(fake).suggest('13000 Berea Rd, Cleveland, OH 44111', { near, expand: true });
    expect(expanded.map((h) => h.label)).toEqual(expect.arrayContaining(['12950 BEREA RD, CLEVELAND, OH, 44111', '12900 BEREA RD, CLEVELAND, OH, 44111']));
    expect(expanded.some((h) => /detroit/i.test(h.label))).toBe(false);
  });
  it('with no number next door either, the street itself is offered, marked as a street', async () => {
    const hits = await new LiveGeocoder(fake).suggest('99999 Berea Rd, Cleveland, OH', { near, expand: true });
    expect(hits[0]!.label).toMatch(/Berea Road, Cleveland, OH \(street, no house number\)/);
  });
  it('results far from the company are left out', async () => {
    const hits = await new LiveGeocoder(fake).suggest('13000 Berea', { near });
    expect(hits).toEqual([]);
  });
});
