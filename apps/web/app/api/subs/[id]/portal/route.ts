import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { resetSubPortal } from '@/lib/subs';

/** A new portal link for the sub, which turns the old one off. The office copies or texts it; Flake sends nothing. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Sub company not found');
  return asUser(ctx, (tx) => resetSubPortal(tx, id));
});
