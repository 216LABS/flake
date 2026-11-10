import { eq, serviceDb, short_link, visit_photo, and } from '@flake/db';
import { NextResponse } from 'next/server';
import { signedUrl } from '@/lib/blob';
import { baseUrl } from '@/lib/env';

/** Own short links. A photo target gets a fresh signed URL each visit, so it never exposes a lasting link. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // The link in sample messages (Settings, Text messages, and the toll-free submission). Real codes are random.
  if (code === 'sample') return NextResponse.redirect(new URL('/', baseUrl()));
  const db = serviceDb();
  const [link] = await db.select().from(short_link).where(eq(short_link.code, code));
  if (!link) return new NextResponse('This link is not valid.', { status: 404 });
  if (link.target.startsWith('photo:')) {
    const [p] = await db.select().from(visit_photo).where(and(eq(visit_photo.id, link.target.slice(6)), eq(visit_photo.tenant_id, link.tenant_id)));
    const url = p && (await signedUrl('photos', p.storage_path));
    if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(link.target, baseUrl()));
}
