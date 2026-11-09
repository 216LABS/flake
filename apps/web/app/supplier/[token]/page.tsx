import { Card, Eyebrow, Wordmark } from '@flake/ui';
import { notFound } from 'next/navigation';
import { money } from '@/lib/client';
import { resolveSupplier, saltOrderingReady, supplierView } from '@/lib/salt-orders';
import { StopActions } from './stop-actions';

export const metadata = { title: 'Salt orders', robots: 'noindex' };
export const dynamic = 'force-dynamic';

const t1 = (n: number) => Math.round(n * 10) / 10;

/** A partner supplier's private page: full loads to deliver, single truckloads, and loads still filling. No login. */
export default async function SupplierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await saltOrderingReady())) notFound();
  const s = await resolveSupplier(token);
  if (!s) notFound();
  const v = await supplierView(s);
  const open = (x: { status: string }) => x.status !== 'delivered';
  const loads = v.loads.filter((l) => l.stops.some(open));
  const direct = v.direct.filter(open);
  const done = [...v.loads.flatMap((l) => l.stops), ...v.direct].filter((x) => x.status === 'delivered');

  const Stop = ({ x, n }: { x: (typeof v.direct)[number]; n?: number }) => (
    <li className="rounded-md border border-slate-200 p-3 text-sm" data-testid="supplier-stop" data-status={x.status}>
      <div className="flex flex-wrap justify-between gap-2">
        <b>{n ? `${n}. ` : ''}{x.company}</b>
        <span className="tabular">{t1(x.tons)} tons, bill {money(x.amount_cents)}</span>
      </div>
      <div className="mt-1 text-slate-700">{x.address}</div>
      <div className="mt-1 text-slate-600">
        {x.needed_by ? `Needed by ${x.needed_by}. ` : ''}{x.contact_name || x.contact_phone ? `Contact ${[x.contact_name, x.contact_phone].filter(Boolean).join(', ')}. ` : ''}{x.notes ?? ''}
      </div>
      {x.status === 'delivered' ? <p className="mt-1 font-medium text-emerald-800">Delivered {t1(x.delivered_tons ?? x.tons)} tons{x.delivery_date ? ` on ${x.delivery_date}` : ''}.</p> : null}
      {x.status === 'scheduled' ? <p className="mt-1 font-medium text-sky-800">Delivery set for {x.delivery_date}.</p> : null}
      <StopActions token={token} id={x.id} status={x.status} tons={x.tons} deliveryDate={x.delivery_date} />
    </li>
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="bg-slate-950 px-4 py-5 text-white">
        <div className="mx-auto max-w-3xl">
          <Eyebrow className="text-beacon">Salt orders from Flake</Eyebrow>
          <h1 className="font-display text-2xl font-semibold">{v.supplier.name}</h1>
          <p className="mt-1 text-sm text-slate-300">{money(v.supplier.price_per_ton_cents)} a ton delivered, {t1(v.supplier.truckload_tons)} ton loads, {money(v.supplier.stop_fee_cents)} a stop on shared loads. Bill each company directly.</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <section aria-labelledby="loads">
          <h2 id="loads" className="mb-2 font-semibold">Full shared loads to deliver</h2>
          {loads.length ? loads.map((l) => (
            <Card key={l.id} className="mb-3" data-testid="supplier-load">
              <p className="mb-2 text-sm text-slate-600">{l.stops.length} stops, {t1(l.stops.reduce((n, x) => n + x.tons, 0))} tons</p>
              <ol className="space-y-2">{l.stops.map((x, i) => <Stop key={x.id} x={x} n={i + 1} />)}</ol>
            </Card>
          )) : <p className="text-sm text-slate-600">None right now.</p>}
        </section>
        <section aria-labelledby="direct">
          <h2 id="direct" className="mb-2 font-semibold">Single truckload orders</h2>
          {direct.length ? <ul className="space-y-2">{direct.map((x) => <Stop key={x.id} x={x} />)}</ul> : <p className="text-sm text-slate-600">None right now.</p>}
        </section>
        <section aria-labelledby="filling">
          <h2 id="filling" className="mb-2 font-semibold">Loads still filling</h2>
          {v.filling.filter((f) => f.tons > 0).length ? v.filling.filter((f) => f.tons > 0).map((f) => (
            <p key={f.id} className="text-sm" data-testid="supplier-filling">{t1(f.tons)} of {t1(f.truckload_tons)} tons ordered so far. You&apos;ll get an email when it&apos;s full.</p>
          )) : <p className="text-sm text-slate-600">None right now.</p>}
        </section>
        {done.length ? (
          <section aria-labelledby="done">
            <h2 id="done" className="mb-2 font-semibold">Delivered</h2>
            <ul className="space-y-1 text-sm text-slate-700">{done.slice(0, 30).map((x) => <li key={x.id}>{x.company}: {t1(x.delivered_tons ?? x.tons)} tons{x.delivery_date ? ` on ${x.delivery_date}` : ''}</li>)}</ul>
          </section>
        ) : null}
        <footer className="flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500">This link is private to {v.supplier.name}. Orders through <Wordmark inverse={false} className="text-base" /></footer>
      </main>
    </div>
  );
}
