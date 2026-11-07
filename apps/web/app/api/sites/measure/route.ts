import { measureRequest } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { measureSite } from '@/lib/measure';

export const POST = route(async (req) => {
  await requireApi('dispatcher');
  const body = await parseJson(req, measureRequest);
  return measureSite(body.lat, body.lon, body.land_use);
});
