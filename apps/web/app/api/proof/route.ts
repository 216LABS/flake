import { proofRequest } from '@flake/contracts';
import { desc, eq, proof_packet, site } from '@flake/db';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { enqueue } from '@/lib/jobs';

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  const items = await asUser(ctx, (tx) => tx.select({ id: proof_packet.id, site_id: proof_packet.site_id, from_ts: proof_packet.from_ts, to_ts: proof_packet.to_ts, manifest_sha256: proof_packet.manifest_sha256, created_at: proof_packet.created_at }).from(proof_packet).orderBy(desc(proof_packet.created_at)).limit(50));
  return { items };
});

/** Queues the render and returns the id it will be stored under; the page polls GET /api/proof/:id. */
export const POST = route(async (req) => {
  const ctx = await requireApi('viewer');
  const { siteId, from, to } = await parseJson(req, proofRequest);
  const [st] = await asUser(ctx, (tx) => tx.select({ id: site.id }).from(site).where(eq(site.id, siteId)));
  if (!st) throw new HttpError(404, 'Site not found');
  const packetId = randomUUID();
  await enqueue('proof.render', { tenantId: ctx.tenantId, siteId, from, to, packetId, createdBy: ctx.userId }, { dedupeKey: `proof:${packetId}` });
  return NextResponse.json({ id: packetId, status: 'queued' }, { status: 202 });
});
