import { describe, expect, it } from 'vitest';
import { expandSeries, summarize, toFahrenheit, toInches } from '@flake/core/trigger';
import { LiveWeather } from '../src/index';

/** Weather has to work wherever a snow company is, not only in Ohio. Runs with LIVE_PROVIDER_TESTS=1, never in pnpm verify. */
const live = process.env.LIVE_PROVIDER_TESTS === '1';
const UA = '(flake.216labs.dev, sam@216labs.dev)';
const PLACES: [string, number, number][] = [
  ['Denver', 39.7392, -104.9903], ['Minneapolis', 44.9778, -93.265], ['Buffalo', 42.8864, -78.8784], ['Boston', 42.3601, -71.0589],
  ['Salt Lake City', 40.7608, -111.891], ['Anchorage', 61.2181, -149.9003], ['Marquette', 46.5436, -87.3954], ['Burlington VT', 44.4759, -73.2121],
];

describe.runIf(live)('NWS across the snow belt', () => {
  for (const [name, lat, lon] of PLACES) {
    it(`${name}: grid, station, snow and temperature parse`, async () => {
      const w = new LiveWeather(UA);
      const g = await w.pointToGrid(lat, lon);
      expect(g.office).toMatch(/^[A-Z]{3}$/);
      expect(g.station).toBeTruthy();
      const doc = await w.fetchGridpoint(g.office, g.gridX, g.gridY);
      if (doc.notModified) throw new Error('unexpected 304');
      const p = doc.json.properties;
      const snow = expandSeries(p.snowfallAmount.values, (v) => toInches(v, p.snowfallAmount.uom));
      const temp = expandSeries(p.temperature.values, (v) => toFahrenheit(v, p.temperature.uom), false);
      expect(snow.length).toBeGreaterThan(24);
      const s = summarize({ snowIn: snow, iceIn: [], tempF: temp }, Date.now());
      expect(s.temp_f).toBeGreaterThan(-60);
      expect(s.temp_f).toBeLessThan(110);
      expect(s.snow_next12h_in).not.toBeNull();
      console.log(name, g.office, g.station, s.temp_f, s.snow_next12h_in);
    }, 60000);
  }
});
