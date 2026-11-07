import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon, Position } from 'geojson';

export const GPS_MATCH_METERS = 150;
export const GEOFENCE_METERS = 75;

export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointToSegmentMeters(lat: number, lon: number, a: Position, b: Position): number {
  const mPerLat = 111320;
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const ax = (a[0]! - lon) * mPerLon;
  const ay = (a[1]! - lat) * mPerLat;
  const bx = (b[0]! - lon) * mPerLon;
  const by = (b[1]! - lat) * mPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** 0 inside the polygon, otherwise distance to the nearest edge. */
export function distanceToPolygonMeters(lat: number, lon: number, geom: Polygon | MultiPolygon): number {
  if (booleanPointInPolygon([lon, lat], geom)) return 0;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i + 1 < ring.length; i++) {
        best = Math.min(best, pointToSegmentMeters(lat, lon, ring[i]!, ring[i + 1]!));
      }
    }
  }
  return best;
}

/** D4: true when the arrive point is within 150 m of the site polygon, or of the centroid if none is drawn. */
export function gpsMatches(
  arriveLat: number | null | undefined,
  arriveLon: number | null | undefined,
  site: { lat: number; lon: number; polygons?: Polygon | MultiPolygon | null },
): boolean {
  if (arriveLat == null || arriveLon == null) return false;
  const d = site.polygons
    ? distanceToPolygonMeters(arriveLat, arriveLon, site.polygons)
    : distanceMeters(arriveLat, arriveLon, site.lat, site.lon);
  return d <= GPS_MATCH_METERS;
}
