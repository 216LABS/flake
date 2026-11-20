import { NextResponse } from 'next/server';
import { visitPhotoUrl } from '@/lib/driver';
import { clientIp, rateLimit, route } from '@/lib/http';
import { portalPhotoPath, resolvePortal } from '@/lib/portal';

/** A fresh short-lived URL each time, so the portal page never holds a lasting link to a photo. */
export const GET = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  const { token, id } = await params;
  await rateLimit(`portal-photo:${clientIp(req)}`, 600, 60_000);
  const who = await resolvePortal(token);
  const photo = who && (await portalPhotoPath(who.customerId, who.tenantId, id));
  if (!photo) return new NextResponse('This photo is unavailable.', { status: 404 });
  const url = await visitPhotoUrl(photo, new URL(req.url).searchParams.has('thumb'));
  if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, max-age=300' } });
});
