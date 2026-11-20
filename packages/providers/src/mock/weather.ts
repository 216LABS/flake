import lakeEffect from '../../fixtures/weather/lakewood-lake-effect-2025-12.json';
import quiet from '../../fixtures/weather/quiet.json';
import refreeze from '../../fixtures/weather/refreeze.json';
import { expandSeries, sumOverlap, toInches } from '@flake/core/trigger';
import type { FetchResult, FetchedDoc, GridRef, ModelPoint, NbmResult, NohrscResult, NowcastResult, RadarResult, StationHistory, WeatherProvider } from '../types';

export const WEATHER_FIXTURES = {
  'lakewood-lake-effect-2025-12': lakeEffect,
  quiet,
  refreeze,
} as const;
export type WeatherFixtureName = keyof typeof WEATHER_FIXTURES;

const enc = new TextEncoder();
const H = 3600000;
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

  /** Synthetic hourly reports: a thaw in the afternoon and a freeze at night, every day, so a packet shows both. */
  async fetchStationHistory(station: string, from: Date, to: Date): Promise<StationHistory | null> {
    const rows = [];
    for (let t = Math.ceil(from.getTime() / 3_600_000) * 3_600_000; t <= to.getTime() && rows.length < 500; t += 3_600_000) {
      const hour = new Date(t).getUTCHours();
      rows.push({ t: new Date(t).toISOString(), temp_f: Math.round((31 + 6 * Math.sin(((hour - 13) / 24) * 2 * Math.PI)) * 10) / 10, precip_in: hour === 6 ? 0.02 : 0, wx: hour === 6 ? '-SN' : null, snow_depth_in: 3 });
    }
    const url = `mock://mesonet.agron.iastate.edu/asos?station=${station}&sts=${from.toISOString()}&ets=${to.toISOString()}&fixture=${this.name}`;
    return { url, raw: enc.encode(JSON.stringify({ _synthetic: true, rows })), rows, provider: 'Synthetic demo data', synthetic: true };
  }

  async fetchNohrsc(hours: 6 | 24, at: Date, points: { id: string; lat: number; lon: number }[]): Promise<NohrscResult | null> {
    const hit = this.fixture.nohrsc.filter((n) => Date.parse(n.valid) <= at.getTime()).at(-1);
    if (!hit) return null;
    const value = hours === 6 ? hit.h6 : hit.h24;
    const url = `mock://www.nohrsc.noaa.gov/snowfall_v2/sfav2_CONUS_${hours}h_${hit.valid.replace(/\D/g, '').slice(0, 10)}.json?fixture=${this.name}`;
    const samples = Object.fromEntries(points.map((p) => [p.id, value]));
    return { url, raw: enc.encode(JSON.stringify({ _synthetic: true, valid: hit.valid, hours, value })), lastModified: hit.valid, validAt: hit.valid, samples, synthetic: true };
  }

  /** The fixture's hourly snow and ice, in inches: the source for the synthetic model runs below. */
  private hourly() {
    const g = this.fixture.gridpoint as { snowfallAmount: { uom: string; values: { validTime: string; value: number | null }[] }; iceAccumulation?: { uom: string; values: { validTime: string; value: number | null }[] } };
    return {
      snow: expandSeries(g.snowfallAmount.values, (v) => toInches(v, g.snowfallAmount.uom)),
      ice: g.iceAccumulation ? expandSeries(g.iceAccumulation.values, (v) => toInches(v, g.iceAccumulation!.uom)) : [],
    };
  }

  /**
   * Synthetic Blend percentiles around the fixture's own forecast: the middle is the fixture, the low half of it and
   * the high 1.6 times, so "likely" and "certain" both show up in the demo.
   */
  async fetchNbm(at: Date, points: ModelPoint[], after?: string | null): Promise<NbmResult | null> {
    const run = Math.floor(at.getTime() / (6 * H)) * 6 * H - 6 * H;
    if (after && Date.parse(after) >= run) return null;
    const { snow } = this.hourly();
    const windows = [6, 12, 18, 24].map((fh) => ({ start: new Date(run + (fh - 6) * H).toISOString(), end: new Date(run + fh * H).toISOString() }));
    const mid = windows.map((w) => sumOverlap(snow, Date.parse(w.start), Date.parse(w.end)));
    const r = (v: number | null, k: number) => (v === null ? null : Math.round(v * k * 10) / 10);
    const one = { p10: mid.map((v) => r(v, 0.5)), p50: mid.map((v) => r(v, 1)), p90: mid.map((v) => r(v, 1.6)) };
    const cycle = new Date(run).toISOString();
    return { url: `mock://nomads.ncep.noaa.gov/blend/${cycle}?fixture=${this.name}`, cycle, windows, samples: Object.fromEntries(points.map((p) => [p.id, one])), raw: enc.encode(JSON.stringify({ _synthetic: true, cycle, windows, one })), synthetic: true };
  }

  async fetchNowcast(at: Date, points: ModelPoint[], after?: string | null): Promise<NowcastResult | null> {
    const run = Math.floor(at.getTime() / H) * H - H;
    if (after && Date.parse(after) >= run) return null;
    const { snow, ice } = this.hourly();
    const hours = Array.from({ length: 6 }, (_, i) => run + i * H);
    const at1 = (b: { t: number; v: number | null }[], t: number) => b.find((x) => x.t === t)?.v ?? 0;
    const one = { snow: hours.map((t) => Math.round(at1(snow, t) * 100) / 100), ice: hours.map((t) => Math.round(at1(ice, t) * 100) / 100) };
    const cycle = new Date(run).toISOString();
    return { url: `mock://nomads.ncep.noaa.gov/hrrr/${cycle}?fixture=${this.name}`, cycle, hours: hours.map((t) => new Date(t).toISOString()), samples: Object.fromEntries(points.map((p) => [p.id, one])), raw: enc.encode(JSON.stringify({ _synthetic: true, cycle, one })), synthetic: true };
  }

  /** Radar's liquid total: a tenth of the fixture's snow, the usual 10 to 1. */
  async fetchRadar(at: Date, points: ModelPoint[]): Promise<RadarResult | null> {
    const { snow } = this.hourly();
    const end = Math.floor(at.getTime() / H) * H;
    const liquid = (hours: number) => {
      const v = sumOverlap(snow, end - hours * H, end);
      return v === null ? null : Math.round((v / 10) * 100) / 100;
    };
    const one = { last1h: liquid(1), last3h: liquid(3) };
    const validAt = new Date(end).toISOString();
    return { url: `mock://mapservices.weather.noaa.gov/mrms_qpe?fixture=${this.name}`, validAt, samples: Object.fromEntries(points.map((p) => [p.id, one])), raw: enc.encode(JSON.stringify({ _synthetic: true, validAt, one })), synthetic: true };
  }
}
