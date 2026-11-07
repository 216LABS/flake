import { describe, expect, it } from 'vitest';
import { estimatePlowableArea } from '@flake/core/area';
import { expandSeries, summarize, toFahrenheit, toInches } from '@flake/core/trigger';
import { LiveGeocoder, LiveOsm, LiveParcels, LiveWeather } from '../src/index';

/** Free public services only, no keys. Runs with LIVE_PROVIDER_TESTS=1, never in pnpm verify. */
const live = process.env.LIVE_PROVIDER_TESTS === '1';
const UA = '(flake.216labs.dev, sam@216labs.dev)';
const LAKEWOOD = { lat: 41.4819, lon: -81.7982 };

describe.runIf(live)('real public data', () => {
  it('parses a real NWS gridpoint through the same engine billing and triggers use', async () => {
    const w = new LiveWeather(UA);
    const g = await w.pointToGrid(LAKEWOOD.lat, LAKEWOOD.lon);
    expect(g.office).toBe('CLE');
    expect(g.station).toBeTruthy();
    const doc = await w.fetchGridpoint(g.office, g.gridX, g.gridY);
    if (doc.notModified) throw new Error('unexpected 304');
    const p = doc.json.properties;
    const snow = expandSeries(p.snowfallAmount.values, (v) => toInches(v, p.snowfallAmount.uom));
    const temp = expandSeries(p.temperature.values, (v) => toFahrenheit(v, p.temperature.uom), false);
    expect(snow.length).toBeGreaterThan(24);
    const s = summarize({ snowIn: snow, iceIn: [], tempF: temp }, Date.now());
    expect(s.temp_f).toBeGreaterThan(-40);
    expect(s.temp_f).toBeLessThan(110);
    expect(s.snow_next12h_in).not.toBeNull();
    expect(doc.lastModified).toBeTruthy();
    const again = await w.fetchGridpoint(g.office, g.gridX, g.gridY, doc.lastModified);
    expect(typeof again.notModified).toBe('boolean');
    console.log('NWS', g, s, 'conditional 304:', again.notModified);
  }, 60000);

  it('reads real observations and alerts', async () => {
    const w = new LiveWeather(UA);
    const g = await w.pointToGrid(LAKEWOOD.lat, LAKEWOOD.lon);
    const obs = await w.fetchObservation(g.station!);
    expect(obs.json.properties).toBeTruthy();
    const alerts = await w.fetchAlerts(LAKEWOOD.lat, LAKEWOOD.lon);
    expect(alerts.json.features).toBeInstanceOf(Array);
    console.log('alerts active:', alerts.json.features.length, 'obs temp:', obs.json.properties.temperature?.value);
  }, 60000);

  it('samples the real NOHRSC analysis at a point in inches, and marks the ocean unavailable', async () => {
    const r = await new LiveWeather(UA).fetchNohrsc(24, new Date('2026-02-01T12:00:00Z'), [{ id: 'lakewood', ...LAKEWOOD }, { id: 'ocean', lat: 30, lon: -70 }]);
    expect(r!.url).toContain('sfav2_CONUS_24h_2026020112.tif');
    // This point sits in a lake-masked cell. The nearest land cell read 0.43 that day.
    expect(r!.samples.lakewood).toBeCloseTo(0.4, 1);
    expect(r!.samples.ocean).toBeNull();
  }, 120000);

  it('geocodes, finds the parcel, finds parking, and estimates an area', async () => {
    const [hit] = await new LiveGeocoder().search('14701 Detroit Ave, Lakewood, OH');
    expect(hit!.lat).toBeCloseTo(41.48, 1);
    const parcel = await new LiveParcels().lookup(hit!.lat, hit!.lon);
    expect(parcel?.county).toBe('cuyahoga');
    expect(parcel!.id).not.toBe('unknown');
    const parking = await new LiveOsm().parkingNear(hit!.lat, hit!.lon, 200).catch(() => []);
    const est = estimatePlowableArea({ parcel: parcel!.geometry, footprints: [], osmParking: parking, landUse: 'commercial' });
    console.log('parcel', parcel!.id, 'parking polygons', parking.length, 'estimate', est);
    expect(est.estimateSqft).toBeGreaterThan(0);
    expect(est.estimateSqft).toBeLessThan(5_000_000);
  }, 60000);
});
