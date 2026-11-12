import type { RouteMatrix } from '../types';

/**
 * OpenRouteService's Matrix API (free tier), driving-car: most plow trucks are pickups and one-ton trucks, which drive
 * like cars. One POST returns seconds between every pair; unroutable pairs come back null. Fails fast, so Suggest order
 * never waits long on it.
 */
export class LiveRouteMatrix implements RouteMatrix {
  readonly source = 'OpenRouteService road times';
  /** The free tier allows 3,500 pairs per call, so 59 points; this leaves room. */
  readonly maxPoints = 50;
  constructor(private key: string, private fetchImpl: typeof fetch = fetch, private timeoutMs = 4000) {}

  async minutes(points: { lat: number; lon: number }[]) {
    if (points.length < 2) return points.map(() => points.map(() => 0));
    if (points.length > this.maxPoints) return null;
    const res = await this.fetchImpl('https://api.openrouteservice.org/v2/matrix/driving-car', {
      method: 'POST',
      headers: { Authorization: this.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locations: points.map((p) => [p.lon, p.lat]), metrics: ['duration'] }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenRouteService ${res.status}`);
    const body = (await res.json()) as { durations?: (number | null)[][] };
    if (!Array.isArray(body.durations) || body.durations.length !== points.length) throw new Error('OpenRouteService returned no matrix');
    return body.durations.map((row) => row.map((s) => (typeof s === 'number' ? s / 60 : null)));
  }
}

/** No key: no road times, and everything plans on estimates as before. */
export const noRouter = (): RouteMatrix => ({ source: 'none', maxPoints: 0, minutes: async () => null });
