import { eq, site_pin } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { putBlob, signedUrl } from '@/lib/blob';
import { HttpError, route } from '@/lib/http';

const MAX_BYTES = 4 * 1024 * 1024;
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id } = await params;
  const [pin] = await asUser(ctx, (tx) => tx.select().from(site_pin).where(eq(site_pin.id, id)));
  const url = pin?.photo_path ? await signedUrl('photos', pin.photo_path) : null;
  if (!url) throw new HttpError(404, 'Not found');
  return NextResponse.redirect(url);
});

/** Re-encoded on the server, which strips metadata and guarantees what's stored is really an image. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const [pin] = await asUser(ctx, (tx) => tx.select().from(site_pin).where(eq(site_pin.id, id)));
  if (!pin) throw new HttpError(404, 'Not found');
  const file = (await req.formData()).get('file');
  if (!(file instanceof Blob)) throw new HttpError(422, 'file is required');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'That photo is too large.');
  const sharp = (await import('sharp')).default;
  let jpeg: Buffer;
  try {
    jpeg = await sharp(new Uint8Array(await file.arrayBuffer())).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  } catch {
    throw new HttpError(422, 'That file is not a photo we can read.', 'not_image');
  }
  const path = `${ctx.tenantId}/pins/${id}.jpg`;
  await putBlob('photos', path, jpeg, 'image/jpeg', { upsert: true });
  await asUser(ctx, (tx) => tx.update(site_pin).set({ photo_path: path }).where(eq(site_pin.id, id)));
  return { ok: true };
});
