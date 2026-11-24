import { currentSeason, fmtLocal } from '@flake/core/time';
import { serviceDb } from '@flake/db';
import { Card, Eyebrow, Stat, Table, Td, Th } from '@flake/ui';
import { notFound } from 'next/navigation';
import { tenantHasPro } from '@/lib/billing';
import { money } from '@/lib/client';
import { period } from '@/lib/reports';
import { portalVisits, resolveSubPortal, subStatement } from '@/lib/subs';
import { PhotoImg } from '@/components/photo-img';
import { AnswerStatement } from './answer';

export const metadata = { title: 'Your work and pay', robots: 'noindex, nofollow' };
export const dynamic = 'force-dynamic';

/**
 * A sub company's portal (issue 226): its own drivers' visits with proof and photos, and its pay statement to agree
 * with or dispute. Lot names and addresses so they can find the work; never customer contacts, prices or other crews.
 */
export default async function SubPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const who = await resolveSubPortal(token);
  if (!who) notFound();
  const tz = who.timezone;
  const p = period(q.from ?? `${currentSeason(new Date(), tz).slice(0, 4)}-07-01`, q.to, tz);
  const pro = tenantHasPro(who.tenant);
  const [visits, statement] = await Promise.all([
    portalVisits(who.sub, p),
    pro ? serviceDb().transaction((tx) => subStatement(tx, who.sub.tenant_id, who.sub.id, p, true)) : Promise.resolve(null),
  ]);
  const day = (iso: string) => fmtLocal(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (iso: string) => fmtLocal(iso, tz, { hour: 'numeric', minute: '2-digit' });
  const photo = (id: string, thumb = false) => `/api/sub/${token}/photo/${id}${thumb ? '?thumb=1' : ''}`;
  const proofed = visits.filter((v) => v.gps && v.depth_in !== null && v.photos.some((x) => x.phase === 'before') && v.photos.some((x) => x.phase === 'after')).length;
  return (
    <div className="min-h-screen bg-tint">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <p className="font-display text-lg font-semibold">{who.company}</p>
          <h1 className="font-display mt-1 text-3xl font-semibold leading-tight">Work and pay for {who.sub.name}</h1>
          <p className="mt-1 text-sm text-slate-300">Your drivers&apos; visits for {who.company}, the proof on each one, and your statement. Times are {who.company} local time.</p>
        </div>
        <div className="chevrons h-1.5" aria-hidden="true" />
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <form className="flex flex-wrap items-end gap-2 text-sm" method="get" data-testid="sub-period">
          <label className="block">From<input className="mt-1 block rounded-control border border-line-strong bg-surface px-2 py-1.5" type="date" name="from" defaultValue={p.from} /></label>
          <label className="block">To<input className="mt-1 block rounded-control border border-line-strong bg-surface px-2 py-1.5" type="date" name="to" defaultValue={p.to} /></label>
          <button className="rounded-control border border-ink bg-ink px-3 py-1.5 font-medium text-white" type="submit">Show</button>
        </form>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Visits" value={String(visits.length)} />
          <Stat label="With full proof" value={visits.length ? `${Math.round((proofed / visits.length) * 100)}%` : 'No visits yet'} />
          {statement ? <Stat label="Statement total" value={money(statement.total_cents)} /> : null}
        </div>
        {statement ? (
          <Card data-testid="sub-statement">
            <Eyebrow className="mb-2">Statement, {p.from} to {p.to}</Eyebrow>
            {statement.lines.length || statement.season.length ? (
              <Table>
                <thead><tr><Th>Driver</Th><Th>Storm</Th><Th className="text-right">Visits</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {statement.lines.map((l) => <tr key={`${l.crew_id}-${l.storm_id}`} data-testid="sub-line"><Td>{l.driver}</Td><Td>{l.storm}</Td><Td className="text-right tabular-nums">{l.visits}</Td><Td className="text-right tabular-nums">{money(l.amount_cents)}</Td></tr>)}
                  {statement.season.map((s) => <tr key={`season-${s.driver}`}><Td>{s.driver}</Td><Td>Season flat rate</Td><Td /><Td className="text-right tabular-nums">{money(s.amount_cents)}</Td></tr>)}
                  {statement.drivers.length > 1 ? statement.drivers.map((d) => <tr key={`total-${d.crew_id}`} className="text-muted"><Td>{d.driver}</Td><Td>Driver total</Td><Td className="text-right tabular-nums">{d.visits}</Td><Td className="text-right tabular-nums">{money(d.total_cents)}</Td></tr>) : null}
                  <tr className="font-semibold"><Td>{who.sub.name}</Td><Td>Total</Td><Td className="text-right tabular-nums">{statement.visits}</Td><Td className="text-right tabular-nums" data-testid="sub-total">{money(statement.total_cents)}</Td></tr>
                </tbody>
              </Table>
            ) : <p className="text-sm text-muted">No paid work in these dates.</p>}
            {/* Nothing to confirm on an empty statement. */}
            {statement.lines.length || statement.season.length ? <AnswerStatement token={token} from={p.from} to={p.to} answer={statement.answer} lines={statement.lines.map((l) => `${l.driver}, ${l.storm}, ${money(l.amount_cents)}`)} /> : null}
          </Card>
        ) : null}
        <section>
          <Eyebrow className="mb-2">Visits</Eyebrow>
          {visits.length ? (
            <ul className="space-y-2" data-testid="sub-visits">
              {visits.map((v) => (
                <li key={v.id} className="rounded-card border border-line bg-surface p-3 text-sm" data-testid="sub-visit">
                  <p className="font-semibold">{v.site}</p>
                  {v.address ? <p className="text-muted">{v.address}</p> : null}
                  <p>{v.storm}, {day(v.arrived)} {time(v.arrived)}{v.departed ? ` to ${time(v.departed)}` : ', not finished'}. {v.driver}.</p>
                  <p className="text-xs text-muted">{v.gps ? 'GPS on arrival' : 'No GPS'}. {v.depth_in === null ? 'No depth' : `${v.depth_in} in of snow`}. {v.photos.length ? `${v.photos.length} photo${v.photos.length === 1 ? '' : 's'}` : 'No photos'}.</p>
                  {v.photos.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.photos.slice(0, 6).map((ph) => <a key={ph.id} href={photo(ph.id)} target="_blank" rel="noreferrer"><PhotoImg src={photo(ph.id, true)} alt={`${ph.phase ?? 'Photo'} at ${v.site}`} className="h-20 w-20 rounded object-cover" loading="lazy" /></a>)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No visits in these dates.</p>}
        </section>
      </main>
    </div>
  );
}
