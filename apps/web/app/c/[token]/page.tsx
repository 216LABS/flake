import { fmtLocal } from '@flake/core/time';
import { Badge, Card, Eyebrow, Stat, Table, Td, Th, Wordmark } from '@flake/ui';
import { notFound } from 'next/navigation';
import { money, phone } from '@/lib/client';
import { portalData, resolvePortal } from '@/lib/portal';

export const metadata = { title: 'Your service records', robots: 'noindex, nofollow' };
export const dynamic = 'force-dynamic';

const SERVICE: Record<string, string> = { plow: 'Plowed', salt: 'Salted', walks: 'Walks cleared', haul: 'Snow hauled' };
const UNIT: Record<string, string> = { bag50lb: '50 lb bags', lb: 'lb', ton: 'tons', application: 'applications' };
const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' }> = {
  paid: { label: 'Paid', tone: 'green' },
  charged: { label: 'Charged to card on file', tone: 'green' },
  sent: { label: 'Due', tone: 'amber' },
  failed: { label: 'Payment failed', tone: 'red' },
};

export default async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const who = await resolvePortal(token);
  const data = who && (await portalData(who.customerId, who.tenantId));
  if (!data) notFound();
  const tz = data.company.timezone;
  const day = (iso: string) => fmtLocal(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (iso: string) => fmtLocal(iso, tz, { hour: 'numeric', minute: '2-digit' });
  const due = data.invoices.filter((i) => i.pay_link);
  const photo = (id: string, thumb = false) => `/api/c/${token}/photo/${id}${thumb ? '?thumb=1' : ''}`;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <p className="font-display text-lg font-semibold">{data.company.name}</p>
          <h1 className="font-display mt-1 text-3xl font-semibold leading-tight md:text-4xl">Service records for {data.customer.name}</h1>
          <p className="mt-1 text-sm text-slate-300">Every visit, with the time, what was done and the driver&apos;s photos. Times are {data.company.name}&apos;s local time.</p>
        </div>
        <div className="chevrons h-1.5" aria-hidden="true" />
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {due.length ? (
          <Card className="border-amber-300 bg-amber-50" data-testid="portal-due">
            <h2 className="font-semibold">{due.length === 1 ? 'An invoice is waiting' : `${due.length} invoices are waiting`}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {due.map((i) => <li key={i.id}>{i.storm}: <b className="tabular">{money(i.total_cents)}</b>. <a className="font-semibold text-sky-800 underline" href={i.pay_link!}>View and pay</a></li>)}
            </ul>
          </Card>
        ) : null}

        {data.sites.map((s) => {
          const done = s.visits.filter((v) => v.departed);
          const last = done[0];
          return (
            <section key={s.id} aria-labelledby={`site-${s.id}`} data-testid="portal-site">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`site-${s.id}`} className="font-display text-2xl font-semibold">{s.label}</h2>
                {s.contract ? <Badge tone={s.contract.status === 'accepted' ? 'green' : 'amber'}>{s.contract.status === 'accepted' ? `Season ${s.contract.season}` : 'Quote waiting'}</Badge> : null}
              </div>
              <p className="mb-3 text-sm text-slate-600">{s.address}</p>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Card><Stat label="Visits" value={done.length} note="Last 18 months" /></Card>
                <Card><Stat label="Last service" value={last ? day(last.departed!) : '-'} note={last ? `Finished ${time(last.departed!)}` : 'No visits yet'} /></Card>
              </div>
              {s.visits.length ? (
                <ol className="space-y-2">
                  {s.visits.map((v, n) => {
                    const row = (
                      <li key={v.id} className="rounded-md border border-slate-200 bg-white p-3" data-testid="portal-visit">
                        <div>
                          <p className="font-semibold">{day(v.arrived)}, {time(v.arrived)}{v.departed ? ` to ${time(v.departed)}` : ''}</p>
                          <p className="text-xs text-slate-600">{v.storm}</p>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-700">
                          {v.departed ? v.services.map((x) => SERVICE[x] ?? x).join(', ') : 'Crew on site now'}
                          {v.replow ? ' (second pass)' : ''}
                          {v.depth !== null ? `. ${v.depth}" of snow` : ''}
                          {v.salt?.length ? `. Salt: ${v.salt.map((e) => `${e.qty} ${UNIT[e.unit] ?? e.unit}`).join(', ')}` : ''}
                        </p>
                        {v.photos.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {v.photos.map((p) => (
                              <a key={p.id} href={photo(p.id)} target="_blank" rel="noopener" className="block text-xs text-slate-600">
                                <img src={photo(p.id, true)} alt={`${p.phase === 'before' ? 'Before' : 'After'} photo, ${day(v.arrived)}`} loading="lazy" className="h-24 w-32 rounded-sm border border-slate-200 bg-slate-100 object-cover" />
                                <span className="mt-0.5 block">{p.phase === 'before' ? 'Before' : 'After'}</span>
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                    return n < 10 ? row : null;
                  })}
                </ol>
              ) : <Card className="text-sm text-slate-600">No visits yet. They show here as soon as the crew finishes.</Card>}
              {s.visits.length > 10 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">All {s.visits.length} visits</summary>
                  <Table className="mt-2">
                    <thead><tr><Th>Date</Th><Th>Time</Th><Th>Done</Th><Th>Photos</Th></tr></thead>
                    <tbody>
                      {s.visits.slice(10).map((v) => (
                        <tr key={v.id}><Td>{day(v.arrived)}</Td><Td className="tabular">{time(v.arrived)}{v.departed ? `-${time(v.departed)}` : ''}</Td><Td>{v.services.map((x) => SERVICE[x] ?? x).join(', ')}</Td><Td>{v.photos.map((p, i) => <a key={p.id} className="mr-2 text-sky-800 underline" href={photo(p.id)} target="_blank" rel="noopener">{i + 1}</a>)}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </details>
              ) : null}
              {s.packets.length ? (
                <p className="mt-3 text-sm" data-testid="portal-packets">
                  Signed service records (PDF):{' '}
                  {s.packets.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<a className="text-sky-800 underline" href={`/api/c/${token}/packet/${p.id}`}>{fmtLocal(p.from, tz, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtLocal(p.to, tz, { month: 'short', day: 'numeric', year: 'numeric' })}</a></span>)}
                </p>
              ) : null}
            </section>
          );
        })}

        {data.invoices.length ? (
          <section aria-labelledby="invoices">
            <Eyebrow id="invoices" className="mb-2">Invoices</Eyebrow>
            <Table data-testid="portal-invoices">
              <thead><tr><Th>Storm</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.storm}</Td>
                    <Td className="tabular text-right">{money(i.total_cents)}</Td>
                    <Td><Badge tone={STATUS[i.status ?? '']?.tone ?? 'blue'}>{STATUS[i.status ?? '']?.label ?? i.status}</Badge>{i.pay_link ? <a className="ml-2 text-sm text-sky-800 underline" href={i.pay_link}>Pay</a> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        ) : null}

        <footer className="border-t border-slate-200 pt-4 text-sm text-slate-600">
          <p>Questions about a visit or a bill? Contact {data.company.name}{data.company.phone ? ` at ${phone(data.company.phone)}` : ''}{data.company.email ? <> or <a className="text-sky-800 underline" href={`mailto:${data.company.email}`}>{data.company.email}</a></> : null}.</p>
          <p className="mt-1 text-xs">This link is private to {data.customer.name}. Anyone with it can see these records, so share it only with people who should.</p>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">Records kept by <Wordmark inverse={false} className="text-base" /></div>
        </footer>
      </main>
    </div>
  );
}
