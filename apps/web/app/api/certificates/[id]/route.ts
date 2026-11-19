import { and, certificate, eq, isNull } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { removeBlob, signedUrl } from '@/lib/blob';
import { HttpError, isUuid, route } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string, min: 'viewer' | 'dispatcher') {
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi(min);
  const [row] = await asUser(ctx, (tx) => tx.select().from(certificate).where(eq(certificate.id, id)));
  if (!row) throw new HttpError(404, 'Not found');
  return { ctx, row };
}

/** The file, through a link good for ten minutes. Office staff only. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { row } = await load((await params).id, 'viewer');
  const url = row.file_path ? await signedUrl('contracts', row.file_path, row.file_name ?? undefined) : null;
  if (!url) throw new HttpError(404, 'No file');
  return NextResponse.redirect(url);
});

/** Make the company's default certificate, the one handed to customers. */
export const PATCH = route<Ctx>(async (_req, { params }) => {
  const { ctx, row } = await load((await params).id, 'dispatcher');
  if (row.crew_id) throw new HttpError(409, 'Only a company certificate can be the default.');
  await asUser(ctx, async (tx) => {
    await tx.update(certificate).set({ is_default: false }).where(and(isNull(certificate.crew_id), eq(certificate.is_default, true)));
    await tx.update(certificate).set({ is_default: true }).where(eq(certificate.id, row.id));
  });
  return { ok: true };
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { ctx, row } = await load((await params).id, 'dispatcher');
  await asUser(ctx, (tx) => tx.delete(certificate).where(eq(certificate.id, row.id)));
  if (row.file_path) await removeBlob('contracts', row.file_path).catch(() => undefined);
  return { ok: true };
});
