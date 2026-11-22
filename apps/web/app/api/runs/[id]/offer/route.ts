import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { offerRun } from '@/lib/noshow';

/** Texts this run's route to the storm's standby drivers; the first YES gets it (issue 234). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  return offerRun(ctx.tenantId, id);
});
