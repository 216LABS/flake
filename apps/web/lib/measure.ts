import { estimatePlowableArea, type LandUse } from '@flake/core/area';
import { cached_lookup, eq, serviceDb } from '@flake/db';
import type { Geom, Parcel } from '@flake/providers';
import { getProviders } from './providers';

const THIRTY_DAYS = 30 * 86400000;

/** 30-day cache for parcel lookups, so one quote doesn't hammer a county server (DECISIONS D4). */
async function cachedParcel(lat: number, lon: number, lookup: () => Promise<Parcel | null>): Promise<Parcel | null> {
  const key = `parcel:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const [hit] = await serviceDb().select().from(cached_lookup).where(eq(cached_lookup.key, key));
  if (hit && Date.now() - Date.parse(hit.fetched_at) < THIRTY_DAYS) return hit.value as Parcel | null;
  const value = await lookup();
  await serviceDb().insert(cached_lookup).values({ key, value: value as object }).onConflictDoUpdate({ target: cached_lookup.key, set: { value: value as object, fetched_at: new Date().toISOString() } });
  return value;
}

export async function measureSite(lat: number, lon: number, landUse: LandUse) {
  const p = await getProviders();
  const parcel = await cachedParcel(lat, lon, () => p.parcel.lookup(lat, lon)).catch(() => null);
  const [footprints, osmParking] = await Promise.all([
    p.footprints.within(lat, lon, 200).catch((): Geom[] => []),
    p.osm.parkingNear(lat, lon, 200).catch((): Geom[] => []),
  ]);
  const estimate = estimatePlowableArea({ parcel: parcel?.geometry ?? null, footprints, osmParking, landUse });
  return { parcel, footprints, osmParking, estimateSqft: estimate.estimateSqft, method: estimate.method, suggestedPolygon: estimate.suggestedPolygon, attribution: [parcel?.attribution, osmParking.length ? '© OpenStreetMap contributors (ODbL)' : null, footprints.length ? 'Overture Maps Buildings (ODbL)' : null].filter(Boolean) };
}
