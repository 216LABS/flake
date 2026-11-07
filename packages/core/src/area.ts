import turfArea from '@turf/area';
import difference from '@turf/difference';
import { feature, featureCollection } from '@turf/helpers';
import intersect from '@turf/intersect';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export const SQFT_PER_SQM = 10.7639104;
export const PAVED_RATIO = { residential: 0.12, commercial: 0.55 } as const;
export type LandUse = keyof typeof PAVED_RATIO;
type Geom = Polygon | MultiPolygon;

export const geodesicSqft = (geom: Geom) => turfArea(feature(geom)) * SQFT_PER_SQM;

function clip(a: Geom, b: Geom): Feature<Geom> | null {
  return intersect(featureCollection([feature(a), feature(b)]));
}

export interface AreaInput {
  parcel: Geom | null;
  footprints: Geom[];
  osmParking: Geom[];
  landUse: LandUse;
  /** Owner-tunable override of the default paved ratio. */
  pavedRatio?: number;
}

export interface AreaEstimate {
  estimateSqft: number | null;
  method: 'osm_parking' | 'parcel_ratio' | 'unavailable';
  suggestedPolygon: Geom | null;
}

/**
 * DECISIONS D4: OSM parking inside the parcel if any exists, otherwise (parcel minus footprints) x ratio.
 * This is always an estimate. The owner draws to confirm, and the confirmed polygon is what prices.
 */
export function estimatePlowableArea(input: AreaInput): AreaEstimate {
  const { parcel, footprints, osmParking, landUse } = input;
  if (!parcel) return { estimateSqft: null, method: 'unavailable', suggestedPolygon: null };

  const clipped = osmParking.map((p) => clip(p, parcel)).filter((f): f is Feature<Geom> => f !== null);
  if (clipped.length) {
    const coords = clipped.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    const suggestedPolygon: MultiPolygon = { type: 'MultiPolygon', coordinates: coords };
    return { estimateSqft: Math.round(geodesicSqft(suggestedPolygon)), method: 'osm_parking', suggestedPolygon };
  }

  let open: Feature<Geom> | null = feature(parcel);
  for (const fp of footprints) {
    open = open && difference(featureCollection([open, feature(fp)]));
  }
  const openSqft = open ? geodesicSqft(open.geometry) : 0;
  const ratio = input.pavedRatio ?? PAVED_RATIO[landUse];
  return { estimateSqft: Math.round(openSqft * ratio), method: 'parcel_ratio', suggestedPolygon: open ? open.geometry : null };
}
