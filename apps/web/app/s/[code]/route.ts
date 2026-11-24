import { eq, serviceDb, short_link, visit_photo, and } from '@flake/db';
import { NextResponse } from 'next/server';
import { visitPhotoUrl } from '@/lib/driver';
import { baseUrl } from '@/lib/env';
import { clientIp, HttpError, rateLimit } from '@/lib/http';

/** Own short links. A photo target gets a fresh signed URL each visit, so it never exposes a lasting link. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // The same per-address backstop as the other public token routes (issue 152). Loose, since many phones on one carrier
  // share an address on a storm night.
  try {
    await rateLimit(`short:${clientIp(req)}`, 120, 60_000);
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse('Too many requests. Wait a minute and try again.', { status: 429 });
    throw e;
  }
  // The link in sample messages (Settings, Text messages, and the toll-free submission). Real codes are random.
  if (code === 'sample') return NextResponse.redirect(new URL('/', baseUrl()));
  const db = serviceDb();
  const [link] = await db.select().from(short_link).where(eq(short_link.code, code));
  if (!link) return new NextResponse('This link is not valid.', { status: 404 });
  // A photo opens a page with the company, the lot, the time and the visit's photos (journey walk, Nov 23). ?raw=1 still
  // gives the image itself.
  if (link.target.startsWith('photo:')) {
    if (new URL(req.url).searchParams.get('raw') !== '1') return NextResponse.redirect(new URL(`/photo/${code}`, baseUrl()));
    const [p] = await db.select().from(visit_photo).where(and(eq(visit_photo.id, link.target.slice(6)), eq(visit_photo.tenant_id, link.tenant_id)));
    const url = p && (await visitPhotoUrl(p, false));
    if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(link.target, baseUrl()));
}
