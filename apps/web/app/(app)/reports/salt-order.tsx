'use client';

import { Badge, Button, Card, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, money } from '@/lib/client';

interface Order {
  id: string; tons: number; address: string; status: string; supplier: string; pool_id: string | null; pool_tons: number | null;
  needed_by: string | null; delivery_date: string | null; delivered_tons: number | null; price_per_ton_cents: number; stop_fee_cents: number;
}
interface Data { on_hand_tons: number | null; per_storm_tons: number | null; advice: { storms_left: number | null; low: boolean; suggest_tons: number }; orders: Order[] }
type Quote =
  | { covered: false; address: string }
  | { covered: true; address: string; supplier: string; miles: number; price_per_ton_cents: number; stop_fee_cents: number; truckload_tons: number; pool_tons: number; path: { kind: 'direct' } | { kind: 'pool'; poolTonsAfter: number; fills: boolean }; total_cents: number };

const STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'green' | 'gray' }> = {
  pooling: { label: 'Filling a shared load', tone: 'amber' },
  ordered: { label: 'With the supplier', tone: 'blue' },
  scheduled: { label: 'Delivery set', tone: 'blue' },
  delivered: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};
const t1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Bulk salt from a partner supplier. A full truckload ships on its own; smaller orders share a load with other
 * companies nearby, so a small company pays bulk prices instead of bag prices. The supplier bills the company.
 */
export function SaltOrder({ initial, defaultAddress, canOrder, truckloadHint = 22 }: { initial: Data; defaultAddress: string; canOrder: boolean; truckloadHint?: number }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tons, setTons] = useState(String(initial.advice.suggest_tons || 10));
  const [address, setAddress] = useState(defaultAddress);
  const [neededBy, setNeededBy] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setData(await api<Data>('/api/salt/orders'));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const a = data.advice;

  return (
    <Card className="mt-4" data-testid="salt-order">
      <h3 className="font-semibold" id="salt">Order bulk salt</h3>
      <p className="mt-1 text-sm text-slate-600">
        From a partner supplier, delivered to your yard. A full truckload (about {truckloadHint} tons) ships on its own. Less than that shares a load with other companies nearby, so you pay the bulk price, not bag prices. The supplier bills you directly.
      </p>
      {a.storms_left !== null ? (
        <p className={`mt-3 rounded-md p-3 text-sm ${a.low ? 'bg-amber-50 text-amber-950' : 'bg-slate-50 text-slate-700'}`} data-testid="salt-advice">
          {a.low
            ? `About ${a.storms_left} storms of salt left at ${data.per_storm_tons} tons a storm. ${a.suggest_tons} tons gets you back to five storms.`
            : `About ${a.storms_left} storms of salt on hand at ${data.per_storm_tons} tons a storm.`}
        </p>
      ) : null}

      {canOrder ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="order-tons">Tons</Label><Input id="order-tons" type="number" min={1} step={1} value={tons} onChange={(e) => { setTons(e.target.value); setQ(null); }} data-testid="order-tons" /></div>
          <div><Label htmlFor="salt-needed">Needed by (optional)</Label><Input id="salt-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="salt-address">Deliver to</Label><Input id="salt-address" value={address} onChange={(e) => { setAddress(e.target.value); setQ(null); }} placeholder="Your yard's street address" data-testid="salt-address" /></div>
          <div><Label htmlFor="salt-contact">Contact at the yard (optional)</Label><Input id="salt-contact" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
          <div><Label htmlFor="salt-phone">Their phone (optional)</Label><Input id="salt-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="outline" disabled={busy || !Number(tons) || address.trim().length < 5} data-testid="salt-quote" onClick={() => run(async () => setQ(await api<Quote>('/api/salt/quote', { body: { address, tons: Number(tons) } })))}>Check price</Button>
            {q?.covered ? (
              <Button variant="accent" disabled={busy} data-testid="salt-place" onClick={() => run(async () => {
                await api('/api/salt/orders', { body: { tons: Number(tons), address, needed_by: neededBy || null, contact_name: contact || null, contact_phone: phone || null } });
                setQ(null);
                setMsg(q.path.kind === 'direct' ? `Ordered. ${q.supplier} has it and will set a delivery date.` : q.path.fills ? `Ordered. Your order filled the truck, so it has gone to ${q.supplier}.` : `Ordered. You're in a shared load, ${t1(q.path.poolTonsAfter)} of ${t1(q.truckload_tons)} tons so far.`);
                await refresh();
                router.refresh();
              })}>Place order</Button>
            ) : q && !q.covered ? (
              <Button variant="outline" disabled={busy} data-testid="salt-request" onClick={() => run(async () => {
                try {
                  await api('/api/salt/orders', { body: { tons: Number(tons), address, needed_by: neededBy || null } });
                } catch (e) {
                  // Expected: no supplier yet. The request is recorded so 216LABS knows where to sign one.
                  if ((e as { code?: string }).code !== 'not_covered') throw e;
                  setQ(null);
                  setMsg((e as Error).message);
                }
              })}>Ask for a supplier here</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {q ? (
        <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm" data-testid="salt-quote-result">
          {!q.covered ? (
            <p>No partner supplier delivers to {q.address} yet. Ask for one and we&apos;ll tell you when one does.</p>
          ) : (
            <>
              <p><b>{q.supplier}</b>, {q.miles} miles away: {money(q.price_per_ton_cents)} a ton delivered{q.path.kind === 'pool' && q.stop_fee_cents ? `, plus ${money(q.stop_fee_cents)} for a stop on a shared load` : ''}.</p>
              <p className="mt-1">About <b className="tabular">{money(q.total_cents)}</b> before tax, billed by {q.supplier}.</p>
              <p className="mt-1 text-slate-600">
                {q.path.kind === 'direct' ? 'A full truckload, so it goes straight to the supplier.'
                  : q.path.fills ? `This fills the shared load (${t1(q.path.poolTonsAfter)} of ${t1(q.truckload_tons)} tons), so it goes to the supplier right away.`
                  : `Joins a shared load: ${t1(q.path.poolTonsAfter)} of ${t1(q.truckload_tons)} tons with yours. It ships when the truck is full. You can cancel until then.`}
              </p>
            </>
          )}
        </div>
      ) : null}
      {msg ? <p className="mt-3 text-sm text-emerald-800" role="status" data-testid="salt-msg">{msg}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}

      {data.orders.length ? (
        <ul className="mt-4 space-y-2" data-testid="salt-orders">
          {data.orders.map((o) => (
            <li key={o.id} className="rounded-md border border-slate-200 p-3 text-sm" data-testid="salt-order-row" data-status={o.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b className="tabular">{t1(o.tons)} tons</b> from {o.supplier}</span>
                <Badge tone={STATUS[o.status]?.tone ?? 'gray'}>{STATUS[o.status]?.label ?? o.status}</Badge>
              </div>
              <div className="mt-1 text-slate-600">
                {o.status === 'pooling' && o.pool_tons !== null ? (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (o.pool_tons / truckloadHint) * 100)}%` }} /></div>
                    <span className="tabular">{t1(o.pool_tons)} of {truckloadHint} tons in this load so far.</span>
                  </>
                ) : o.status === 'ordered' ? `${o.supplier} has it and will set a delivery date. ${o.address}` : o.status === 'scheduled' ? `Delivery on ${o.delivery_date}.` : o.status === 'delivered' ? `Delivered ${t1(o.delivered_tons ?? o.tons)} tons${o.delivery_date ? ` on ${o.delivery_date}` : ''}. Added to your salt count.` : o.address}
              </div>
              {canOrder && (o.status === 'pooling' || (o.status === 'ordered' && !o.pool_id)) ? (
                <Button size="sm" variant="ghost" className="mt-1 -ml-3" disabled={busy} data-testid="salt-cancel" onClick={() => run(async () => { await api(`/api/salt/orders/${o.id}`, { method: 'DELETE' }); await refresh(); })}>Cancel order</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
