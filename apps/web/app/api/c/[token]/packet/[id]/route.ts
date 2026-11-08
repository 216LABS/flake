import { NextResponse } from 'next/server';
import { signedUrl } from '@/lib/blob';
import { clientIp, rateLimit, route } from '@/lib/http';
import { portalPacketPath, resolvePortal } from '@/lib/portal';

export const GET = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  const { token, id } = await params;
  rateLimit(`portal-packet:${clientIp(req)}`, 60, 60_000);
  const who = await resolvePortal(token);
  const path = who && (await portalPacketPath(who.customerId, who.tenantId, id));
  const url = path && (await signedUrl('proof', path, 'service-record.pdf'));
  if (!url) return new NextResponse('This record is unavailable.', { status: 404 });
  return NextResponse.redirect(url);
});
