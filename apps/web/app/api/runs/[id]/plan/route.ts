import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { planRun } from '@/lib/storms';

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  return planRun({ ...ctx, timezone: ctx.tenant.timezone }, id);
});
