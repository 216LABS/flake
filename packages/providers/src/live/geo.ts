import { readFile } from 'node:fs/promises';
import { distanceMeters } from '@flake/core/geo';
import type { FootprintProvider, GeocodeHit, Geocoder, Geom, OsmProvider, Parcel, ParcelProvider, TileProvider } from '../types';

/**
 * County parcel services (DECISIONS D4), queried live by point. Cuyahoga's polygon layer was checked against the
 * live server on 2026-11-06. The other counties have no verified endpoint yet, so they are off until a URL is set,
 * and a lookup there reads as unavailable rather than guessing.
 */
export function countyParcels(env: Record<string, string | undefined> = process.env): { county: string; url: string; idField: string }[] {
  return [
    { county: 'cuyahoga', url: 'https://gis.cuyahogacounty.gov/server/rest/services/CCFO/Current_Year_Appraisal_Parcels/MapServer/2/query', idField: 'PARCELPIN' },
    ...(['summit', 'lorain', 'lake', 'medina'] as const).flatMap((county) => {
      const url = env[`PARCEL_URL_${county.toUpperCase()}`];
      return url ? [{ county, url, idField: env[`PARCEL_ID_FIELD_${county.toUpperCase()}`] ?? 'PARCEL' }] : [];
    }),
  ];
}

export class LiveParcels implements ParcelProvider {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async lookup(lat: number, lon: number): Promise<Parcel | null> {
    for (const c of countyParcels()) {
      const params = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '25', units: 'esriSRUnit_Meter', outFields: c.idField, returnGeometry: 'true', outSR: '4326', f: 'geojson' });
      try {
        const res = await this.fetchImpl(`${c.url}?${params}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const body = (await res.json()) as { features?: { geometry: Geom; properties: Record<string, unknown> }[] };
        const f = body.features?.[0];
        if (f?.geometry) return { id: String(f.properties[c.idField] ?? 'unknown'), county: c.county, geometry: f.geometry, attribution: `${c.county} County open data` };
      } catch {
        continue;
      }
    }
    return null;
  }
}

/** Reads a local Overture Maps extract (GeoJSON FeatureCollection). With no extract configured it returns nothing. */
export class LiveFootprints implements FootprintProvider {
  private cache: Promise<{ geometry: Geom; lat: number; lon: number }[]> | null = null;
  constructor(private path?: string) {}
  private load() {
    this.cache ??= (async () => {
      if (!this.path) return [];
      const fc = JSON.parse(await readFile(this.path, 'utf8')) as { features: { geometry: Geom }[] };
      return fc.features.map((f) => {
        const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0]![0])!;
        return { geometry: f.geometry, lon: ring[0]![0]!, lat: ring[0]![1]! };
      });
    })();
    return this.cache;
  }
  async within(lat: number, lon: number, radiusM: number): Promise<Geom[]> {
    return (await this.load()).filter((f) => distanceMeters(lat, lon, f.lat, f.lon) <= radiusM).map((f) => f.geometry);
  }
}

export class LiveOsm implements OsmProvider {
  constructor(private url = 'https://overpass-api.de/api/interpreter', private fetchImpl: typeof fetch = fetch) {}
  async parkingNear(lat: number, lon: number, radiusM: number): Promise<Geom[]> {
    const query = `[out:json][timeout:10];way["amenity"="parking"](around:${radiusM},${lat},${lon});out geom;`;
    const res = await this.fetchImpl(this.url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { elements?: { geometry?: { lat: number; lon: number }[] }[] };
    return (body.elements ?? [])
      .filter((e) => (e.geometry?.length ?? 0) >= 4)
      .map((e) => ({ type: 'Polygon', coordinates: [e.geometry!.map((p) => [p.lon, p.lat])] }));
  }
}

export class LiveGeocoder implements Geocoder {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async search(q: string): Promise<GeocodeHit[]> {
    const params = new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' });
    const res = await this.fetchImpl(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] } };
    return (body.result?.addressMatches ?? []).map((m) => ({ label: m.matchedAddress, lat: m.coordinates.y, lon: m.coordinates.x }));
  }

  /**
   * Photon (OpenStreetMap data, free, no key). Census only answers complete addresses, so it can't do type-ahead,
   * and Nominatim's usage policy forbids it. Biased to Northeast Ohio. Any failure just means no suggestions.
   */
  async suggest(q: string): Promise<GeocodeHit[]> {
    const params = new URLSearchParams({ q, limit: '6', lat: '41.48', lon: '-81.8', lang: 'en' });
    try {
      const res = await this.fetchImpl(`https://photon.komoot.io/api/?${params}`, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Flake (flake.216labs.dev)' } });
      if (!res.ok) return [];
      const body = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[] };
      const seen = new Set<string>();
      const hits: GeocodeHit[] = [];
      for (const f of body.features ?? []) {
        const p = f.properties;
        if (p.countrycode !== 'US') continue;
        const street = [p.housenumber, p.street ?? p.name].filter(Boolean).join(' ');
        const label = [street, p.city ?? p.district ?? p.county, [p.state === 'Ohio' ? 'OH' : p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        if (!street || seen.has(label)) continue;
        seen.add(label);
        hits.push({ label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
      }
      return hits;
    } catch {
      return [];
    }
  }
}

/** [T] Confirm the basemap free-tier terms before launch (DECISIONS D2). */
export class LiveTiles implements TileProvider {
  constructor(private mapboxToken?: string) {}
  layers() {
    return {
      streets: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors', maxzoom: 19 },
      satellite: this.mapboxToken
        ? { tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${this.mapboxToken}`], attribution: '© Mapbox © Maxar', maxzoom: 20 }
        : { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery © Esri', maxzoom: 19 },
    };
  }
}
