import { and, eq, job, proof_packet, serviceDb, sql } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { signedUrl } from '@/lib/blob';
import { HttpError, isUuid, route } from '@/lib/http';

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const [p] = await asUser(ctx, (tx) => tx.select().from(proof_packet).where(eq(proof_packet.id, id)));
  if (p) return { status: 'ready', id: p.id, manifest_sha256: p.manifest_sha256, sha256: p.sha256, url: await signedUrl('proof', p.pdf_path, `proof-packet-${p.id.slice(0, 8)}.pdf`) };
  // Still being made only if this company queued it (issue 130). A mistyped, deleted or other company's id is a 404,
  // so nothing polls forever, and one that failed for good says so.
  const [queued] = await serviceDb().select({ dead_at: job.dead_at, done_at: job.done_at }).from(job)
    .where(and(eq(job.dedupe_key, `proof:${id}`), sql`${job.payload}->>'tenantId' = ${ctx.tenantId}`));
  if (!queued) throw new HttpError(404, 'Not found');
  if (queued.dead_at || queued.done_at) throw new HttpError(500, 'This proof packet could not be made. Try again, and tell support if it fails twice.', 'proof_failed');
  return NextResponse.json({ status: 'pending' }, { status: 202 });
});
