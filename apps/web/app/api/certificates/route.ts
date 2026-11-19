import { and, certificate, crew_member, eq, isNull } from '@flake/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { putBlob } from '@/lib/blob';
import { HttpError, route } from '@/lib/http';
import { sha256Hex } from '@/lib/tokens';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const fields = z.object({
  crew_id: z.uuid().optional(),
  kind: z.enum(['general_liability', 'auto', 'workers_comp', 'umbrella', 'w9', 'other']),
  insurer: z.string().trim().max(200).optional(),
  policy_number: z.string().trim().max(100).optional(),
  effective_on: z.iso.date().optional(),
  expires_on: z.iso.date().optional(),
  is_default: z.enum(['true', 'false']).optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine((b) => b.kind === 'w9' || Boolean(b.expires_on), { message: 'A certificate of insurance needs its end date.', path: ['expires_on'] })
  .refine((b) => !b.effective_on || !b.expires_on || b.effective_on <= b.expires_on, { message: 'The end date is before the start date.', path: ['expires_on'] });

/**
 * A certificate of insurance (or a sub's W-9), with its file: the company's own when crew_id is empty, else a sub's
 * (issue 165). PDF, JPEG or PNG, up to 10 MB, kept private; it is downloaded, never emailed.
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const form = await req.formData();
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v as string]));
  const parsed = fields.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? 'Check the certificate', 'invalid');
  const b = parsed.data;
  if (b.kind === 'w9' && !b.crew_id) throw new HttpError(422, 'A W-9 belongs to a sub. Pick the sub.');
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(422, 'Attach the certificate (PDF or photo).', 'no_file');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'That file is over 10 MB.');
  const ext = TYPES[file.type];
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes, not the label: a PDF starts %PDF, a JPEG FF D8, a PNG 89 50 4E 47.
  const real = ext === 'pdf' ? bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 : ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : ext === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50 : false;
  if (!ext || !real) throw new HttpError(422, 'Upload a PDF, JPEG or PNG.', 'bad_type');
  const id = crypto.randomUUID();
  return asUser(ctx, async (tx) => {
    if (b.crew_id) {
      const [c] = await tx.select({ kind: crew_member.kind }).from(crew_member).where(eq(crew_member.id, b.crew_id));
      if (!c) throw new HttpError(404, 'Crew member not found');
    }
    const path = `${ctx.tenantId}/coi/${id}.${ext}`;
    await putBlob('contracts', path, bytes, file.type);
    const isDefault = !b.crew_id && b.is_default === 'true';
    if (isDefault) await tx.update(certificate).set({ is_default: false }).where(and(isNull(certificate.crew_id), eq(certificate.is_default, true)));
    const name = file instanceof File && file.name ? file.name.slice(0, 200) : `certificate.${ext}`;
    const [row] = await tx.insert(certificate).values({ id, tenant_id: ctx.tenantId, crew_id: b.crew_id ?? null, kind: b.kind, insurer: b.insurer ?? null, policy_number: b.policy_number ?? null, effective_on: b.effective_on ?? null, expires_on: b.expires_on ?? null, file_path: path, file_sha256: sha256Hex(bytes), file_name: name, is_default: isDefault, notes: b.notes ?? null, created_by: ctx.userId }).returning();
    return NextResponse.json(row, { status: 201 });
  });
});
