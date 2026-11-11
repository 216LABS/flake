import { and, eq, gte, lte, site, sql, visit, visit_photo } from '@flake/db';
import { proofRequest } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';

/** What a packet for this site and these dates will hold, so the office knows before it generates (issue 43). */
export const GET = route(async (req) => {
  const ctx = await requireApi('viewer');
  const q = new URL(req.url).searchParams;
  const parsed = proofRequest.safeParse({ siteId: q.get('siteId'), from: q.get('from'), to: q.get('to') });
  if (!parsed.success) throw new HttpError(422, 'Choose a site and dates.', 'invalid');
  const { siteId, from, to } = parsed.data;
  return asUser(ctx, async (tx) => {
    const [st] = await tx.select({ id: site.id }).from(site).where(eq(site.id, siteId));
    if (!st) throw new HttpError(404, 'Site not found');
    const inRange = and(eq(visit.site_id, siteId), gte(visit.arrived_device_at, from), lte(visit.arrived_device_at, to));
    const [v] = await tx.select({ visits: sql<number>`count(*)::int`, withPhotos: sql<number>`count(*) filter (where exists (select 1 from visit_photo p where p.visit_id = ${visit.id}))::int` }).from(visit).where(inRange);
    const [p] = await tx.select({ photos: sql<number>`count(*)::int` }).from(visit_photo).innerJoin(visit, eq(visit.id, visit_photo.visit_id)).where(inRange);
    return { visits: v?.visits ?? 0, visits_with_photos: v?.withPhotos ?? 0, photos: p?.photos ?? 0 };
  });
});
