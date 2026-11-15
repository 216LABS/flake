import { and, eq, site_walk_item } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { signedUrl } from '@/lib/blob';
import { HttpError, isUuid, route } from '@/lib/http';

/** A short-lived link to a walk photo, for anyone in the company. */
export const GET = route<{ params: Promise<{ id: string; itemId: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) throw new HttpError(404, 'Not found');
  const [item] = await asUser(ctx, (tx) => tx.select().from(site_walk_item).where(and(eq(site_walk_item.id, itemId), eq(site_walk_item.site_id, id))));
  const url = item?.photo_path ? await signedUrl('photos', item.photo_path) : null;
  if (!url) throw new HttpError(404, 'Not found');
  return NextResponse.redirect(url);
});
