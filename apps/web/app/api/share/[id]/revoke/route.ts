import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { revokeShare } from '@/lib/share-links';

/** Turns a share link off at once (issue 236). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  return asUser(ctx, (tx) => revokeShare(tx, id));
});
