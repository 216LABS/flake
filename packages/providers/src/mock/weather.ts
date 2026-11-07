import lakeEffect from '../../fixtures/weather/lakewood-lake-effect-2025-12.json';
import quiet from '../../fixtures/weather/quiet.json';
import refreeze from '../../fixtures/weather/refreeze.json';
import type { FetchResult, FetchedDoc, GridRef, NohrscResult, WeatherProvider } from '../types';

export const WEATHER_FIXTURES = {
  'lakewood-lake-effect-2025-12': lakeEffect,
  quiet,
  refreeze,
} as const;
export type WeatherFixtureName = keyof typeof WEATHER_FIXTURES;

const enc = new TextEncoder();
const doc = (url: string, json: unknown, lastModified: string | null): FetchedDoc => ({
  notModified: false,
  url,
  raw: enc.encode(JSON.stringify(json)),
  json,
  lastModified,
  synthetic: true,
});

/** Replays clearly synthetic fixtures. Every response carries `_synthetic: true` and a mock:// source URL. */
export class MockWeather implements WeatherProvider {
  private fixture: (typeof WEATHER_FIXTURES)[WeatherFixtureName];
  constructor(private name: WeatherFixtureName) {
    this.fixture = WEATHER_FIXTURES[name];
  }

  async pointToGrid(lat: number, lon: number): Promise<GridRef> {
    return { office: 'CLE', gridX: 80 + Math.floor((lon + 82) * 20), gridY: 60 + Math.floor((lat - 41) * 20), station: 'KCLE' };
  }

  async fetchGridpoint(office: string, x: number, y: number, ifModifiedSince?: string | null): Promise<FetchResult> {
    const url = `mock://api.weather.gov/gridpoints/${office}/${x},${y}?fixture=${this.name}`;
    const lastModified = this.fixture.lastModified;
    if (ifModifiedSince && Date.parse(ifModifiedSince) >= Date.parse(lastModified)) return { notModified: true, url };
    return doc(url, { _synthetic: true, properties: this.fixture.gridpoint }, lastModified);
  }

  async fetchAlerts(lat: number, lon: number, at: Date): Promise<FetchedDoc> {
    const features = this.fixture.alerts.filter((a) => at.getTime() >= Date.parse(a.onset) && at.getTime() < Date.parse(a.ends)).map((a) => ({ id: a.id, properties: a }));
    return doc(`mock://api.weather.gov/alerts/active?point=${lat},${lon}&fixture=${this.name}`, { _synthetic: true, features }, null);
  }

  async fetchObservation(station: string, at: Date): Promise<FetchedDoc> {
    const series = this.fixture.gridpoint.temperature.values;
    const hit = series.filter((v) => Date.parse(v.validTime.split('/')[0]!) <= at.getTime()).at(-1);
    return doc(`mock://api.weather.gov/stations/${station}/observations/latest?fixture=${this.name}`, { _synthetic: true, properties: { timestamp: at.toISOString(), textDescription: 'Synthetic', temperature: { unitCode: 'wmoUnit:degC', value: hit?.value ?? null } } }, null);
  }

  async fetchNohrsc(hours: 6 | 24, at: Date, points: { id: string; lat: number; lon: number }[]): Promise<NohrscResult | null> {
    const hit = this.fixture.nohrsc.filter((n) => Date.parse(n.valid) <= at.getTime()).at(-1);
    if (!hit) return null;
    const value = hours === 6 ? hit.h6 : hit.h24;
    const url = `mock://www.nohrsc.noaa.gov/snowfall_v2/sfav2_CONUS_${hours}h_${hit.valid.replace(/\D/g, '').slice(0, 10)}.json?fixture=${this.name}`;
    const samples = Object.fromEntries(points.map((p) => [p.id, value]));
    return { url, raw: enc.encode(JSON.stringify({ _synthetic: true, valid: hit.valid, hours, value })), lastModified: hit.valid, validAt: hit.valid, samples, synthetic: true };
  }
}
