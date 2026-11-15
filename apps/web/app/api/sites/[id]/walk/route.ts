import { siteWalkCreate } from '@flake/contracts';
import { eq, site, site_walk_item } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { putBlob } from '@/lib/blob';
import { readImageMeta } from '@/lib/driver';
import { HttpError, isUuid, route } from '@/lib/http';
import { sha256Hex } from '@/lib/tokens';

const MAX_BYTES = 15 * 1024 * 1024;
type Ctx = { params: Promise<{ id: string }> };

/**
 * One pre-season site walk item: what's there before the first snow, with an optional photo. The photo is re-encoded
 * (so what's stored is really an image) and hashed; the time it was taken comes from the photo itself when it says.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Site not found');
  const [lot] = await asUser(ctx, (tx) => tx.select({ id: site.id }).from(site).where(eq(site.id, id)));
  if (!lot) throw new HttpError(404, 'Site not found');
  const form = await req.formData();
  const field = (k: string) => (typeof form.get(k) === 'string' && (form.get(k) as string).trim() ? (form.get(k) as string) : undefined);
  const parsed = siteWalkCreate.safeParse({ season: field('season'), kind: field('kind'), note: field('note'), taken_at: field('taken_at'), lat: field('lat') ? Number(field('lat')) : undefined, lon: field('lon') ? Number(field('lon')) : undefined });
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? 'Check the walk item', 'invalid');
  const file = form.get('file');
  if (!(file instanceof Blob) && !parsed.data.note) throw new HttpError(422, 'Add a photo or a note.', 'empty');
  const itemId = crypto.randomUUID();
  let photo: { path: string; sha: string; taken: string | null } | null = null;
  if (file instanceof Blob) {
    if (file.size > MAX_BYTES) throw new HttpError(413, 'That photo is too large.');
    const original = new Uint8Array(await file.arrayBuffer());
    const sharp = (await import('sharp')).default;
    let jpeg: Buffer;
    try {
      jpeg = await sharp(original).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      throw new HttpError(422, 'That file is not a photo we can read.', 'not_image');
    }
    const meta = await readImageMeta(original);
    const exifAt = (meta.exif?.DateTimeOriginal ?? meta.exif?.CreateDate) as string | undefined;
    const path = `${ctx.tenantId}/walk/${id}/${itemId}.jpg`;
    await putBlob('photos', path, jpeg, 'image/jpeg', { upsert: true });
    photo = { path, sha: sha256Hex(jpeg), taken: exifAt && !Number.isNaN(Date.parse(exifAt)) ? new Date(exifAt).toISOString() : null };
  }
  const [row] = await asUser(ctx, (tx) => tx.insert(site_walk_item).values({
    id: itemId, tenant_id: ctx.tenantId, site_id: id, season: parsed.data.season, kind: parsed.data.kind, note: parsed.data.note ?? null,
    photo_path: photo?.path ?? null, photo_sha256: photo?.sha ?? null, taken_at: photo?.taken ?? parsed.data.taken_at ?? new Date().toISOString(),
    lat: parsed.data.lat ?? null, lon: parsed.data.lon ?? null, created_by: ctx.userId,
  }).returning());
  return NextResponse.json(row, { status: 201 });
});
