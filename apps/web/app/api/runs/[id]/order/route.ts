import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { reorderRun } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { stop_ids } = await parseJson(req, z.object({ stop_ids: z.array(z.string().uuid()).min(1).max(500) }));
  return reorderRun(ctx, id, stop_ids);
});
