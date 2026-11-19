import { requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { pollQboPayments, qboConnected, retryQboWaiting } from '@/lib/qbo';

/** Sync now: retries bills that couldn't go, and checks QuickBooks for payments. */
export const POST = route(async () => {
  const ctx = await requireApi('dispatcher');
  if (!(await qboConnected(ctx.tenantId))) throw new HttpError(409, 'QuickBooks is not connected.', 'not_connected');
  const retried = await retryQboWaiting(ctx.tenantId);
  const { paid } = await pollQboPayments(ctx.tenantId);
  return { retried, paid };
});
