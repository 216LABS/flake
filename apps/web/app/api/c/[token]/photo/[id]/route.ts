import { NextResponse } from 'next/server';
import { signedUrl } from '@/lib/blob';
import { clientIp, rateLimit, route } from '@/lib/http';
import { portalPhotoPath, resolvePortal } from '@/lib/portal';

/** A fresh short-lived URL each time, so the portal page never holds a lasting link to a photo. */
export const GET = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  const { token, id } = await params;
  rateLimit(`portal-photo:${clientIp(req)}`, 600, 60_000);
  const who = await resolvePortal(token);
  const path = who && (await portalPhotoPath(who.customerId, who.tenantId, id));
  if (!path) return new NextResponse('This photo is unavailable.', { status: 404 });
  const thumb = new URL(req.url).searchParams.has('thumb');
  const url = (thumb && (await signedUrl('photos', `${path}.thumb.jpg`))) || (await signedUrl('photos', path));
  if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, max-age=300' } });
});
