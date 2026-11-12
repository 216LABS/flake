import { getProviders } from './providers';
import { HttpError } from './http';

/** One address to a point on the map, or a plain message the person can act on. */
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number; label: string }> {
  const { geocoder } = await getProviders();
  const [hit] = await geocoder.search(address);
  if (!hit) throw new HttpError(422, "We couldn't find that address. Check it and try again.", 'address_not_found');
  return { lat: hit.lat, lon: hit.lon, label: hit.label };
}
