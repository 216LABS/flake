import { requireApi } from '@/lib/auth';
import { markInstallmentPaid } from '@/lib/billing';
import { HttpError, isUuid, route } from '@/lib/http';

/** A seasonal installment paid by check, or billed by the office itself. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  return markInstallmentPaid(ctx, id);
});
