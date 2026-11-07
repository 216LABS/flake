import type { FootprintProvider, GeocodeHit, Geocoder, Geom, OsmProvider, Parcel, ParcelProvider, TileProvider } from '../types';

const rect = (lon: number, lat: number, w: number, h: number): Geom => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]],
});

/** Stable pseudo-location near Lakewood, OH from any text. Fake on purpose; used with PROVIDERS_MODE=mock only. */
function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class MockGeocoder implements Geocoder {
  async search(q: string): Promise<GeocodeHit[]> {
    const h = hashText(q.trim().toLowerCase());
    return [{ label: `${q.trim()} (mock geocode)`, lat: 41.47 + ((h % 400) / 400) * 0.03, lon: -81.84 + (((h >> 9) % 400) / 400) * 0.06 }];
  }
}

/** A square parcel centered on the point, about 110 m on a side. */
export class MockParcels implements ParcelProvider {
  async lookup(lat: number, lon: number): Promise<Parcel | null> {
    return { id: `MOCK-${Math.round(lat * 10000)}-${Math.round(Math.abs(lon) * 10000)}`, county: 'mock', geometry: rect(lon - 0.0006, lat - 0.0005, 0.0012, 0.001), attribution: 'Mock parcel (not real data)' };
  }
}

export class MockFootprints implements FootprintProvider {
  async within(lat: number, lon: number): Promise<Geom[]> {
    return [rect(lon - 0.0002, lat - 0.0002, 0.0004, 0.0003)];
  }
}

/** Even-numbered cells have mapped parking so both estimator paths show up in mock mode. */
export class MockOsm implements OsmProvider {
  async parkingNear(lat: number, lon: number): Promise<Geom[]> {
    const even = (Math.round(lat * 1000) + Math.round(Math.abs(lon) * 1000)) % 2 === 0;
    return even ? [rect(lon - 0.0005, lat + 0.0001, 0.001, 0.0003)] : [];
  }
}

export class MockTiles implements TileProvider {
  constructor(private baseUrl: string) {}
  layers() {
    const tiles = [`${this.baseUrl}/api/tiles/mock/{z}/{x}/{y}`];
    return {
      streets: { tiles, attribution: 'Mock tiles (no map data)' },
      satellite: { tiles, attribution: 'Mock tiles (no imagery)' },
    };
  }
}
