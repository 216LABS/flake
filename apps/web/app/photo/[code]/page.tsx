import { and, eq, serviceDb, short_link, site, tenant, visit, visit_photo } from '@flake/db';
import { photoOrder } from '@flake/core/proof';
import { fmtLocal } from '@flake/core/time';
import { Wordmark } from '@flake/ui';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { visitPhotoUrl } from '@/lib/driver';
import { HttpError, rateLimit } from '@/lib/http';

export const metadata = { title: 'Service photo', robots: 'noindex' };
export const dynamic = 'force-dynamic';

const PHASE: Record<string, string> = { before: 'Before', after: 'After', issue: 'Problem' };

/**
 * What a customer opens from "cleared at 9:37 PM. Photo: …" (journey walk, Nov 23): the company, the lot, when it was
 * done and the visit's photos, instead of a bare image file at a storage address. The short code is the key, the same
 * as before; each photo gets a fresh signed address on every open, so nothing here lasts beyond the visit.
 */
export default async function Photo({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    await rateLimit(`short:${ip}`, 120, 60_000);
  } catch (e) {
    if (e instanceof HttpError) return <Shell><p>Too many requests. Wait a minute and try again.</p></Shell>;
    throw e;
  }
  const db = serviceDb();
  const [link] = await db.select().from(short_link).where(eq(short_link.code, code));
  if (!link || !link.target.startsWith('photo:')) notFound();
  const [p] = await db.select().from(visit_photo).where(and(eq(visit_photo.id, link.target.slice(6)), eq(visit_photo.tenant_id, link.tenant_id)));
  if (!p) return <Shell><h1 className="font-display text-2xl font-semibold">This photo is no longer available</h1><p className="mt-2 text-muted">Ask the company that plows for you; they keep a record of every visit.</p></Shell>;
  const [row] = await db.select({ v: visit, s: site, t: tenant }).from(visit).innerJoin(site, eq(site.id, visit.site_id)).innerJoin(tenant, eq(tenant.id, visit.tenant_id)).where(and(eq(visit.id, p.visit_id), eq(visit.tenant_id, link.tenant_id)));
  if (!row) notFound();
  const all = (await db.select().from(visit_photo).where(and(eq(visit_photo.visit_id, p.visit_id), eq(visit_photo.tenant_id, link.tenant_id)))).sort(photoOrder);
  const urls = await Promise.all(all.map(async (x) => ({ id: x.id, phase: x.phase, url: await visitPhotoUrl(x, false) })));
  const tz = row.t.timezone;
  const done = row.v.departed_device_at ?? row.v.arrived_device_at;
  return (
    <Shell>
      <p className="text-sm font-semibold text-muted">{row.t.name}</p>
      <h1 className="mt-1 font-display text-2xl font-semibold leading-tight" data-testid="photo-site">{row.s.label}</h1>
      <p className="mt-1 text-sm text-muted">{row.s.address}</p>
      <p className="mt-3 font-medium" data-testid="photo-when">
        {row.v.departed_device_at ? 'Cleared' : 'Visited'} {fmtLocal(done, tz)}{row.v.depth_in !== null ? `. ${row.v.depth_in}" of snow` : ''}.
      </p>
      <div className="mt-4 grid gap-3">
        {urls.map((x) => (
          <figure key={x.id} className={x.id === p.id ? 'rounded-surface ring-2 ring-beacon' : undefined} data-testid="photo-figure">
            {x.url ? <img src={x.url} alt={`${PHASE[x.phase ?? ''] ?? 'Photo'} photo at ${row.s.label}`} className="w-full rounded-surface bg-tint" /> : <div className="rounded-surface bg-tint p-6 text-sm text-muted">Photo unavailable</div>}
            <figcaption className="mt-1 text-sm text-muted">{PHASE[x.phase ?? ''] ?? 'Photo'}</figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted">Times are {row.t.name}&apos;s local time. This link is private to your service; share it only with people who should see it.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
      {children}
      <div className="mt-8 flex items-center gap-2 text-xs text-muted">Records kept by <Wordmark inverse={false} /></div>
    </main>
  );
}
