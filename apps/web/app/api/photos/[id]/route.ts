import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { isUuid, route } from '@/lib/http';
import { officePhotoUrl } from '@/lib/stop-detail';

/** A visit photo for the office, through a fresh short-lived URL, so the page never holds a lasting link. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id } = await params;
  const url = isUuid(id) ? await officePhotoUrl(ctx.userId, id, new URL(req.url).searchParams.has('thumb')) : null;
  if (!url) return new NextResponse('This photo is unavailable.', { status: 404 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, max-age=300' } });
});
