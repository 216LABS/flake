import type { FetchResult, FetchedDoc, GridRef, NohrscResult, WeatherProvider } from '../types';

const BASE = 'https://api.weather.gov';

/** NOHRSC National Gridded Snowfall Analysis GeoTIFF. Pattern checked against the live server on 2026-11-06. */
export function nohrscUrl(hours: 6 | 24, issued: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ym = `${issued.getUTCFullYear()}${pad(issued.getUTCMonth() + 1)}`;
  const stamp = `${ym}${pad(issued.getUTCDate())}${pad(issued.getUTCHours())}`;
  return `https://www.nohrsc.noaa.gov/snowfall_v2/data/${ym}/sfav2_CONUS_${hours}h_${stamp}.tif`;
}

export class LiveWeather implements WeatherProvider {
  constructor(private userAgent: string, private fetchImpl: typeof fetch = fetch) {}

  private async get(url: string, headers: Record<string, string> = {}, attempt = 0): Promise<Response> {
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/geo+json', ...headers } });
    if (res.status === 429 && attempt < 1) {
      await new Promise((r) => setTimeout(r, 5000 + Math.random() * 1000));
      return this.get(url, headers, attempt + 1);
    }
    return res;
  }

  private async doc(url: string): Promise<FetchedDoc> {
    const res = await this.get(url);
    if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
    const raw = new Uint8Array(await res.arrayBuffer());
    return { notModified: false, url, raw, json: JSON.parse(new TextDecoder().decode(raw)), lastModified: res.headers.get('last-modified') };
  }

  async pointToGrid(lat: number, lon: number): Promise<GridRef> {
    const { json } = await this.doc(`${BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const p = json.properties;
    let station: string | null = null;
    if (p.observationStations) {
      const stations = await this.doc(p.observationStations);
      station = stations.json.features?.[0]?.properties?.stationIdentifier ?? null;
    }
    return { office: p.gridId, gridX: p.gridX, gridY: p.gridY, station };
  }

  async fetchGridpoint(office: string, x: number, y: number, ifModifiedSince?: string | null): Promise<FetchResult> {
    const url = `${BASE}/gridpoints/${office}/${x},${y}`;
    const res = await this.get(url, ifModifiedSince ? { 'If-Modified-Since': new Date(ifModifiedSince).toUTCString() } : {});
    if (res.status === 304) return { notModified: true, url };
    if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
    const raw = new Uint8Array(await res.arrayBuffer());
    return { notModified: false, url, raw, json: JSON.parse(new TextDecoder().decode(raw)), lastModified: res.headers.get('last-modified') };
  }

  fetchAlerts(lat: number, lon: number): Promise<FetchedDoc> {
    return this.doc(`${BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
  }

  fetchObservation(station: string): Promise<FetchedDoc> {
    return this.doc(`${BASE}/stations/${station}/observations/latest`);
  }

  /** The analysis is issued at 00Z and 12Z and can lag, so this walks back to the newest file that exists. */
  async fetchNohrsc(hours: 6 | 24, at: Date, points: { id: string; lat: number; lon: number }[]): Promise<NohrscResult | null> {
    const issued = new Date(at);
    issued.setUTCMinutes(0, 0, 0);
    issued.setUTCHours(issued.getUTCHours() - (issued.getUTCHours() % 12));
    for (let i = 0; i < 4; i++) {
      const url = nohrscUrl(hours, issued);
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent } });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return { url, raw: new Uint8Array(buffer), lastModified: res.headers.get('last-modified'), validAt: issued.toISOString(), samples: await sampleGeoTiff(buffer, points) };
      }
      issued.setUTCHours(issued.getUTCHours() - 12);
    }
    return null;
  }
}

/**
 * The GeoTIFF is in inches: the 2026-02-01 24 h file peaks at 17.3 with 566 cells over 12, impossible in metres.
 * Negative or nodata cells (-99999) mean no analysis at that point, which is unavailable and never zero.
 */
export function nohrscCellToInches(v: number, nodata: number | null): number | null {
  return v === nodata || v < 0 || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
}

/**
 * The cell holding the point, or else the nearest valid cell around it. The grid is 0.04 degrees and masks open
 * water, so lakeshore sites (Lakewood, Rocky River, Cleveland's west side) often land in a nodata cell.
 * Three by three cells, row by row; (fx, fy) is the point's position inside the center cell, from 0 to 1.
 */
export function nearestValidCell(cells: ArrayLike<number>, fx: number, fy: number, nodata: number | null): number | null {
  const center = nohrscCellToInches(cells[4]!, nodata);
  if (center !== null) return center;
  let best: { d: number; v: number } | null = null;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const v = nohrscCellToInches(cells[row * 3 + col]!, nodata);
      if (v === null) continue;
      const d = (col - 1 + 0.5 - fx) ** 2 + (row - 1 + 0.5 - fy) ** 2;
      if (!best || d < best.d) best = { d, v };
    }
  }
  return best ? best.v : null;
}

async function sampleGeoTiff(buffer: ArrayBuffer, points: { id: string; lat: number; lon: number }[]): Promise<Record<string, number | null>> {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin() as [number, number];
  const [resX, resY] = image.getResolution() as [number, number];
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.getGDALNoData();
  const out: Record<string, number | null> = {};
  for (const p of points) {
    const fx = (p.lon - originX) / resX;
    const fy = (p.lat - originY) / resY;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) {
      out[p.id] = null;
      continue;
    }
    const raster = (await image.readRasters({ window: [x - 1, y - 1, x + 2, y + 2] })) as unknown as ArrayLike<number>[];
    out[p.id] = nearestValidCell(raster[0]!, fx - x, fy - y, nodata);
  }
  return out;
}
