import { proofRequest } from '@flake/contracts';
import { desc, eq, proof_packet, site } from '@flake/db';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { enqueue, runSoon } from '@/lib/jobs';
import { isLocalOrTest } from '@/lib/env';

// Room to render the packet after answering the request.
export const maxDuration = 60;

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  const items = await asUser(ctx, (tx) => tx.select({ id: proof_packet.id, site_id: proof_packet.site_id, from_ts: proof_packet.from_ts, to_ts: proof_packet.to_ts, manifest_sha256: proof_packet.manifest_sha256, created_at: proof_packet.created_at }).from(proof_packet).orderBy(desc(proof_packet.created_at)).limit(50));
  return { items };
});

/** Queues the render and returns the id it will be stored under; the page polls GET /api/proof/:id. */
// A viewer can make packets on purpose: they're read-only copies of records, which an insurer or lawyer asks the office
// for (issue 135). Each one renders a PDF and stores it, so anyone gets ten a minute.
export const POST = route(async (req) => {
  const ctx = await requireApi('viewer');
  // The test run signs dozens of parallel browsers in as one demo user, so it gets more room than a real person needs.
  await rateLimit(`proof:${ctx.userId}`, isLocalOrTest() ? 120 : 10, 60_000);
  const { siteId, from, to, incident_at } = await parseJson(req, proofRequest);
  const [st] = await asUser(ctx, (tx) => tx.select({ id: site.id }).from(site).where(eq(site.id, siteId)));
  if (!st) throw new HttpError(404, 'Site not found');
  const packetId = randomUUID();
  await enqueue('proof.render', { tenantId: ctx.tenantId, siteId, from, to, packetId, createdBy: ctx.userId, ...(incident_at ? { incidentAt: incident_at } : {}) }, { dedupeKey: `proof:${packetId}` });
  // Made right after this answer, not at the next scheduled run, so the office isn't left waiting (issue 196).
  runSoon(`proof:${packetId}`);
  return NextResponse.json({ id: packetId, status: 'queued' }, { status: 202 });
});
