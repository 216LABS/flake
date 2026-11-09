import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { cancelOrder } from '@/lib/salt-orders';

/** Cancel while the load is still filling, or before the supplier has a single-truckload order scheduled. */
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return cancelOrder(ctx, (await params).id);
});
