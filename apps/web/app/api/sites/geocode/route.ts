import { geocodeRequest } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

export const POST = route(async (req) => {
  await requireApi('dispatcher');
  const { q } = await parseJson(req, geocodeRequest);
  const { geocoder } = await getProviders();
  return { hits: await geocoder.search(q) };
});
