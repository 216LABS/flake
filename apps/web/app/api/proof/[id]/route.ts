import { eq, proof_packet } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { signedUrl } from '@/lib/blob';
import { route } from '@/lib/http';

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id } = await params;
  const [p] = await asUser(ctx, (tx) => tx.select().from(proof_packet).where(eq(proof_packet.id, id)));
  if (!p) return NextResponse.json({ status: 'pending' }, { status: 202 });
  return { status: 'ready', id: p.id, manifest_sha256: p.manifest_sha256, sha256: p.sha256, url: await signedUrl('proof', p.pdf_path, `proof-packet-${p.id.slice(0, 8)}.pdf`) };
});
