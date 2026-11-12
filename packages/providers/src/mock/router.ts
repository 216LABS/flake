import type { RouteMatrix } from '../types';

/**
 * Road times for tests: the city-block distance between points at 20 mph, which differs from the straight-line
 * estimate, so a test can tell which one a plan used.
 */
export class MockRouteMatrix implements RouteMatrix {
  readonly source = 'mock road times';
  readonly maxPoints = 50;
  async minutes(points: { lat: number; lon: number }[]) {
    if (points.length > this.maxPoints) return null;
    const miles = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) * 69 + Math.abs(a.lon - b.lon) * 52;
    return points.map((a) => points.map((b) => (miles(a, b) / 20) * 60));
  }
}
