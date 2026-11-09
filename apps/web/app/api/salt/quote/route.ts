import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { quote, saltOrderingReady } from '@/lib/salt-orders';

export const POST = route(async (req) => {
  await requireApi('dispatcher');
  if (!(await saltOrderingReady())) throw new HttpError(404, 'Not found');
  const { address, tons } = await parseJson(req, z.object({ address: z.string().trim().min(5).max(200), tons: z.number().positive().max(500) }));
  return quote(address, tons);
});
