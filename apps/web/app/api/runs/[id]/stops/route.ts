import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { addStopToRun } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { site_id } = await parseJson(req, z.object({ site_id: z.string().uuid() }));
  return addStopToRun(ctx, id, site_id);
});
