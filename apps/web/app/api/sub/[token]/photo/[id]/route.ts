import { NextResponse } from 'next/server';
import { visitPhotoUrl } from '@/lib/driver';
import { clientIp, isUuid, rateLimit, route } from '@/lib/http';
import { resolveSubPortal, subPhotoPath } from '@/lib/subs';

/** A photo the sub's own driver took, by a fresh short-lived URL each time. */
export const GET = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  const { token, id } = await params;
  await rateLimit(`sub-photo:${clientIp(req)}`, 600, 60_000);
  const who = isUuid(id) ? await resolveSubPortal(token) : null;
  const photo = who && (await subPhotoPath(who.sub, id));
  if (!photo) return new NextResponse('This photo is unavailable.', { status: 404 });
  const url = await visitPhotoUrl(photo, new URL(req.url).searchParams.has('thumb'));
  if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, max-age=300' } });
});
