import { createHash } from 'node:crypto';
import type { ModelPoint, NbmResult, NowcastResult, RadarResult } from '../types';
import { decodeGrib2, parseIdx, sampleField, type IdxEntry } from './grib2';

/**
 * Free NOAA model and radar data for issue 203, all public domain, read at many points in one pass:
 * - National Blend of Models (NBM), 6-hour snowfall percentiles, from the 00/06/12/18 UTC runs (only those carry them).
 * - HRRR, the hourly 3 km model, for the next 6 hours during storms.
 * - MRMS radar-estimated precipitation, through the NWS map service.
 * NOMADS publishes a byte index (.idx) for each GRIB2 file, so only the fields used are downloaded.
 */
const NOMADS = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com';
const MRMS = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer';
const H = 3600000;
const M_TO_IN = 39.3701;
const MM_TO_IN = 1 / 25.4;

type Fetch = typeof fetch;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const round = (v: number | null, places = 1) => (v === null ? null : Math.round(v * 10 ** places) / 10 ** places);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface Read { url: string; range: string; sha256: string; field: string }

class Nomads {
  readonly reads: Read[] = [];
  constructor(private fetchImpl: Fetch, private userAgent: string) {}
  async idx(url: string): Promise<IdxEntry[] | null> {
    const res = await this.fetchImpl(`${url}.idx`, { headers: { 'User-Agent': this.userAgent } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`NOMADS ${res.status} for ${url}.idx`);
    return parseIdx(await res.text());
  }
  /** One field by its .idx line, decoded and sampled at every point. */
  async sample(url: string, entries: IdxEntry[], match: (line: string) => boolean, points: ModelPoint[]): Promise<Record<string, number | null> | null> {
    const e = entries.find((x) => match(x.line));
    if (!e) return null;
    const range = `bytes=${e.start}-${e.end ?? ''}`;
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, Range: range } });
    if (res.status !== 206 && res.status !== 200) throw new Error(`NOMADS ${res.status} for ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.reads.push({ url, range, sha256: sha(bytes), field: e.line.split(':').slice(3).join(':') });
    const field = decodeGrib2(bytes);
    return Object.fromEntries(points.map((p) => [p.id, sampleField(field, p.lat, p.lon)]));
  }
}

/** The newest run that has its files out, walking back from `at` a step at a time. */
async function newestRun(n: Nomads, at: Date, step: number, tries: number, file: (run: Date) => string): Promise<{ run: Date; idx: IdxEntry[] } | null> {
  const run = new Date(at);
  run.setUTCMinutes(0, 0, 0);
  run.setUTCHours(run.getUTCHours() - (run.getUTCHours() % step));
  for (let i = 0; i < tries; i++) {
    const idx = await n.idx(file(run));
    if (idx) return { run: new Date(run), idx };
    run.setUTCHours(run.getUTCHours() - step);
  }
  return null;
}

const nbmFile = (run: Date, fh: number) => `${NOMADS}/blend/prod/blend.${ymd(run)}/${pad(run.getUTCHours())}/core/blend.t${pad(run.getUTCHours())}z.core.f${String(fh).padStart(3, '0')}.co.grib2`;
const hrrrFile = (run: Date, fh: number) => `${NOMADS}/hrrr/prod/hrrr.${ymd(run)}/conus/hrrr.t${pad(run.getUTCHours())}z.wrfsfcf${pad(fh)}.grib2`;

const manifest = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

export async function fetchNbm(fetchImpl: Fetch, userAgent: string, at: Date, points: ModelPoint[], after?: string | null): Promise<NbmResult | null> {
  const n = new Nomads(fetchImpl, userAgent);
  // Percentiles come with the 00, 06, 12 and 18 UTC runs, a couple of hours after the hour. The last file is checked
  // first, so a run still being written isn't taken half done.
  const found = await newestRun(n, at, 6, 3, (run) => nbmFile(run, 24));
  if (!found) return null;
  const cycle = found.run.toISOString();
  if (after && Date.parse(after) >= found.run.getTime()) return null;
  const windows: { start: string; end: string }[] = [];
  const samples: NbmResult['samples'] = Object.fromEntries(points.map((p) => [p.id, { p10: [], p50: [], p90: [] }]));
  for (const fh of [6, 12, 18, 24]) {
    const url = nbmFile(found.run, fh);
    const idx = fh === 24 ? found.idx : await n.idx(url);
    if (!idx) return null;
    windows.push({ start: new Date(found.run.getTime() + (fh - 6) * H).toISOString(), end: new Date(found.run.getTime() + fh * H).toISOString() });
    for (const p of [10, 50, 90] as const) {
      const got = await n.sample(url, idx, (l) => l.includes(`:ASNOW:surface:${fh - 6}-${fh} hour acc@(fcst,dt=6 hour)`) && l.endsWith(`:${p}% level`), points);
      for (const pt of points) samples[pt.id]![`p${p}`].push(got ? round(got[pt.id] == null ? null : Math.max(0, got[pt.id]! * M_TO_IN)) : null);
    }
  }
  return { url: nbmFile(found.run, 6), cycle, windows, samples, raw: manifest({ source: 'NOAA National Blend of Models', cycle, reads: n.reads, windows, samples }) };
}

export async function fetchNowcast(fetchImpl: Fetch, userAgent: string, at: Date, points: ModelPoint[], after?: string | null): Promise<NowcastResult | null> {
  const n = new Nomads(fetchImpl, userAgent);
  // Every hour, about an hour after. The sixth hour's file is the last of the six written.
  const found = await newestRun(n, at, 1, 4, (run) => hrrrFile(run, 6));
  if (!found) return null;
  const cycle = found.run.toISOString();
  if (after && Date.parse(after) >= found.run.getTime()) return null;
  // Snow and freezing rain are totals since the run began, so each hour is this hour's total less the last.
  const total = { snow: [] as Record<string, number | null>[], ice: [] as Record<string, number | null>[] };
  for (let fh = 1; fh <= 6; fh++) {
    const url = hrrrFile(found.run, fh);
    const idx = fh === 6 ? found.idx : await n.idx(url);
    if (!idx) return null;
    total.snow.push((await n.sample(url, idx, (l) => l.includes(`:ASNOW:surface:0-${fh} hour acc fcst:`), points)) ?? {});
    total.ice.push((await n.sample(url, idx, (l) => l.includes(`:FRZR:surface:0-${fh} hour acc fcst:`), points)) ?? {});
  }
  const hourly = (series: Record<string, number | null>[], id: string, toIn: number) => series.map((s, i) => {
    const now = s[id];
    const before = i === 0 ? 0 : series[i - 1]![id];
    return now == null || before == null ? null : round(Math.max(0, (now - before) * toIn), 2);
  });
  const samples = Object.fromEntries(points.map((p) => [p.id, { snow: hourly(total.snow, p.id, M_TO_IN), ice: hourly(total.ice, p.id, MM_TO_IN) }]));
  const hours = Array.from({ length: 6 }, (_, i) => new Date(found.run.getTime() + i * H).toISOString());
  return { url: hrrrFile(found.run, 1), cycle, hours, samples, raw: manifest({ source: 'NOAA HRRR', cycle, reads: n.reads, hours, samples }) };
}

export async function fetchRadar(fetchImpl: Fetch, userAgent: string, points: ModelPoint[]): Promise<RadarResult | null> {
  const get = async (url: string, body?: URLSearchParams) => {
    const res = await fetchImpl(url, body ? { method: 'POST', headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' }, body } : { headers: { 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`MRMS ${res.status}`);
    return res.json() as Promise<any>;
  };
  const rasters = await get(`${MRMS}/query?where=${encodeURIComponent("name in ('conus_QPE_01H','conus_QPE_03H')")}&outFields=objectid,name,idp_validendtime&returnGeometry=false&f=json`);
  const byName = new Map<string, { id: number; valid: number }>((rasters.features ?? []).map((f: any) => [f.attributes.name, { id: f.attributes.objectid, valid: f.attributes.idp_validendtime }]));
  const one = byName.get('conus_QPE_01H');
  const three = byName.get('conus_QPE_03H');
  if (!one || !three) return null;
  const reads: { name: string; raster: number; points: number }[] = [];
  const sampleAll = async (name: string, raster: number) => {
    const out: Record<string, number | null> = {};
    // A few hundred points per request keeps each one well under the server's limits.
    for (let i = 0; i < points.length; i += 200) {
      const chunk = points.slice(i, i + 200);
      const body = new URLSearchParams({
        geometry: JSON.stringify({ points: chunk.map((p) => [p.lon, p.lat]), spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint',
        mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [raster] }),
        returnFirstValueOnly: 'true', f: 'json',
      });
      const json = await get(`${MRMS}/getSamples`, body);
      for (const s of json.samples ?? []) {
        const v = Number(s.value);
        const p = chunk[s.locationId];
        // Negative is MRMS's "no coverage" (beyond radar range): unavailable, not zero.
        if (p) out[p.id] = Number.isFinite(v) && v >= 0 ? round(v, 2) : null;
      }
      reads.push({ name, raster, points: chunk.length });
    }
    return out;
  };
  const h1 = await sampleAll('conus_QPE_01H', one.id);
  const h3 = await sampleAll('conus_QPE_03H', three.id);
  const validAt = new Date(one.valid).toISOString();
  const samples = Object.fromEntries(points.map((p) => [p.id, { last1h: h1[p.id] ?? null, last3h: h3[p.id] ?? null }]));
  return { url: `${MRMS}/getSamples`, validAt, samples, raw: manifest({ source: 'NOAA MRMS radar-only QPE (NWS map service)', validAt, reads, samples }) };
}
