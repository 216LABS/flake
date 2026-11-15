import { and, eq, site_walk_item } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { removeBlob } from '@/lib/blob';
import { HttpError, isUuid, route } from '@/lib/http';

/** An item added by mistake can be removed, photo and all. */
export const DELETE = route<{ params: Promise<{ id: string; itemId: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) throw new HttpError(404, 'Not found');
  const [gone] = await asUser(ctx, (tx) => tx.delete(site_walk_item).where(and(eq(site_walk_item.id, itemId), eq(site_walk_item.site_id, id))).returning());
  if (!gone) throw new HttpError(404, 'Not found');
  if (gone.photo_path) await removeBlob('photos', gone.photo_path);
  return { ok: true };
});
