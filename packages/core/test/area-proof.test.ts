import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from 'geojson';
import { estimatePlowableArea, geodesicSqft, PAVED_RATIO } from '../src/area';
import { buildManifest, canonicalJson, WEATHER_CAVEAT, type ProofInput } from '../src/proof';

const rect = (x: number, y: number, w: number, h: number): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] });
const parcel = rect(-81.8, 41.48, 0.001, 0.001);

describe('estimatePlowableArea', () => {
  it('is unavailable with no parcel', () => {
    expect(estimatePlowableArea({ parcel: null, footprints: [], osmParking: [], landUse: 'commercial' })).toEqual({ estimateSqft: null, method: 'unavailable', suggestedPolygon: null });
  });
  it('uses OSM parking clipped to the parcel', () => {
    const out = estimatePlowableArea({ parcel, footprints: [], osmParking: [rect(-81.8, 41.48, 0.0005, 0.002)], landUse: 'commercial' });
    expect(out.method).toBe('osm_parking');
    expect(out.estimateSqft).toBeCloseTo(geodesicSqft(rect(-81.8, 41.48, 0.0005, 0.001)), -2);
  });
  it('handles a parking result that clips to a MultiPolygon', () => {
    const lot: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(-81.8, 41.48, 0.0002, 0.0002).coordinates, rect(-81.7995, 41.48, 0.0002, 0.0002).coordinates] };
    expect(estimatePlowableArea({ parcel, footprints: [], osmParking: [lot], landUse: 'commercial' }).method).toBe('osm_parking');
  });
  it('falls back to parcel minus footprints times the ratio when parking is outside', () => {
    const out = estimatePlowableArea({ parcel, footprints: [rect(-81.8, 41.48, 0.0005, 0.001)], osmParking: [rect(-80, 40, 0.001, 0.001)], landUse: 'residential' });
    expect(out.method).toBe('parcel_ratio');
    expect(out.estimateSqft).toBeCloseTo(geodesicSqft(rect(-81.7995, 41.48, 0.0005, 0.001)) * PAVED_RATIO.residential, -2);
  });
  it('honors an owner-tuned ratio', () => {
    expect(estimatePlowableArea({ parcel, footprints: [], osmParking: [], landUse: 'commercial', pavedRatio: 1 }).estimateSqft).toBeCloseTo(geodesicSqft(parcel), -1);
  });
  it('is zero when a footprint covers the whole parcel, including a second footprint after that', () => {
    const out = estimatePlowableArea({ parcel, footprints: [parcel, rect(-81.8, 41.48, 0.0001, 0.0001)], osmParking: [], landUse: 'commercial' });
    expect(out.estimateSqft).toBe(0);
    expect(out.suggestedPolygon).toBeNull();
  });
});

const snap = (id: string, at: string) => ({ id, source: 'nws_grid', request_url: 'u', fetched_at: at, last_modified: null, sha256: 'a'.repeat(64), summary: { b: 1, a: 2 } });
const photo = (id: string, phase: string) => ({ id, phase, storage_path: 'p', sha256: 'b'.repeat(64), taken_device_at: null, received_at: '2025-12-12T00:00:00Z' });
const visit = (id: string, at: string) => ({
  id, storm_id: 's', crew_name: 'c', arrived_device_at: at, arrived_received_at: at, departed_device_at: null, departed_received_at: null, arrive_lat: 1, arrive_lon: 2, arrive_acc_m: 3,
  services: ['plow'], salt: null, depth_in: 2, is_replow: false, gps_match: true, photos: [photo('p2', 'before'), photo('p1', 'after')],
});
const input = (): ProofInput => ({
  contractor: { name: 'c', timezone: 'UTC' }, customer: { name: 'x' }, site: { id: 'site', label: 'l', address: 'a', lat: 1, lon: 2 }, period: { from: 'f', to: 't' }, contract: null,
  storms: [{ id: 'b', name: 'B', started_at: '2025-12-13', closed_at: null, snapshots: [] }, { id: 'a', name: 'A', started_at: '2025-12-12', closed_at: null, snapshots: [snap('s2', '2'), snap('s1', '1')] }],
  visits: [visit('v2', '2025-12-13'), visit('v1', '2025-12-12')],
  messages: [{ id: 'm2', channel: 'sms', template: 't', body: 'b', created_at: '2', status: null }, { id: 'm1', channel: 'sms', template: 't', body: 'b', created_at: '1', status: null }],
  corrections: [{ id: 'c1', visit_id: 'v1', field: 'salt', old_value: null, new_value: [], reason: 'r', created_at: '1' }],
});

describe('proof manifest', () => {
  it('canonicalJson sorts keys, drops undefined props, handles nested and scalars', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }, null] })).toBe('{"a":[{"d":1},null],"b":1}');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });
  it('sorts deterministically and carries the caveat', () => {
    const { manifest } = buildManifest(input());
    expect(manifest.storms.map((s) => s.id)).toEqual(['a', 'b']);
    expect(manifest.storms[0]!.snapshots.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(manifest.visits[0]!.photos.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(manifest.messages[0]!.id).toBe('m1');
    expect(manifest.caveat).toBe(WEATHER_CAVEAT);
  });
  it('same inputs in any order give the same hash', () => {
    const a = input();
    const b = input();
    b.visits.reverse();
    b.storms.reverse();
    b.messages.reverse();
    expect(buildManifest(a).hash).toBe(buildManifest(b).hash);
    expect(buildManifest(a).hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('any correction or snapshot change alters the hash', () => {
    const a = input();
    const b = input();
    b.corrections.push({ id: 'c2', visit_id: 'v1', field: 'salt', old_value: null, new_value: [], reason: 'r', created_at: '2' });
    expect(buildManifest(a).hash).not.toBe(buildManifest(b).hash);
    const c = input();
    c.storms[1]!.snapshots[0]!.sha256 = 'c'.repeat(64);
    expect(buildManifest(a).hash).not.toBe(buildManifest(c).hash);
  });
});
