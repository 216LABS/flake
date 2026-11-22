import { NextResponse } from 'next/server';
import { signedUrl } from '@/lib/blob';
import { clientIp, rateLimit, route } from '@/lib/http';
import { renewalPdf } from '@/lib/renewal-pdf';
import { renewalPack } from '@/lib/renewal-pack';
import { openShare } from '@/lib/share-links';

/** The shared document itself (issue 236): the packet PDF, or the renewal pack made fresh. Each download is logged. */
export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  await rateLimit(`share:${clientIp(req)}`, 30, 60000);
  const { token } = await params;
  const s = await openShare(token, { ip: clientIp(req), ua: req.headers.get('user-agent') });
  if (s.packet) {
    const url = await signedUrl('proof', s.packet.pdf_path, `proof-packet-${s.packet.id.slice(0, 8)}.pdf`);
    if (url) return NextResponse.redirect(url);
  }
  if (s.link.kind === 'renewal' && s.link.params.from && s.link.params.to) {
    const pack = await renewalPack(s.link.tenant_id, s.link.params.from, s.link.params.to);
    return new Response(new Uint8Array(await renewalPdf(pack, 'America/New_York')), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="snow-service-documentation.pdf"' } });
  }
  return NextResponse.json({ error: 'This document is not available.' }, { status: 404 });
});
