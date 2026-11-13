'use client';

import { Badge, Button, Card, Input, Label, Table, Td, Th } from '@flake/ui';
import { useState } from 'react';
import { api, money } from '@/lib/client';
import { useConfirm } from '@/components/confirm';

interface Supplier {
  id: string; name: string; email: string; radius_mi: number; price_per_ton_cents: number; truckload_tons: number; stop_fee_cents: number;
  referral_fee_per_ton_cents: number; active: boolean; link: string; open_tons: number; open_since: string | null; open_needed_by: string | null; orders: number; delivered_tons: number; fees_earned_cents: number; fees_pending_cents: number;
}
interface Data { suppliers: Supplier[]; waitlist: { at: string; tenant: string; address: string; tons: number }[] }

const blank = { name: '', contact_name: '', email: '', phone: '', address: '', radius_mi: '40', price: '80.00', truckload: '22', stop_fee: '75.00', fee: '3.00' };
const cents = (s: string) => Math.round(Number(s) * 100);
const t1 = (n: number) => Math.round(n * 10) / 10;
const days = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d < 1 ? 'under a day' : d === 1 ? '1 day' : `${d} days`;
};

export function SaltAdmin({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, dialog] = useConfirm();
  const reload = async () => setData(await api<Data>('/api/admin/salt/suppliers'));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (s: Supplier) => {
    try {
      await navigator.clipboard.writeText(s.link);
      setMsg(`Copied ${s.name}'s link.`);
    } catch {
      setMsg(s.link);
    }
  };
  const total = data.suppliers.reduce((n, s) => n + s.fees_earned_cents, 0);

  return (
    <div className="space-y-6">
      {dialog}
      <Card>
        <h2 className="font-semibold">Suppliers</h2>
        <p className="mt-1 text-sm text-muted">Referral fees earned on delivered salt: <b className="tabular" data-testid="fees-earned">{money(total)}</b>. Invoice each supplier for theirs.</p>
        {data.suppliers.length ? (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <thead>
                <tr><Th>Supplier</Th><Th className="text-right">Price a ton</Th><Th className="text-right">Your fee a ton</Th><Th className="text-right">Filling now</Th><Th className="text-right">Delivered</Th><Th className="text-right">Fees earned</Th><Th className="text-right">Fees coming</Th><Th>Link</Th></tr>
              </thead>
              <tbody>
                {data.suppliers.map((s) => (
                  <tr key={s.id} data-testid="supplier-row">
                    <Td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted">{s.email}, {s.radius_mi} mi, {s.truckload_tons} t loads</div>
                      {s.active ? null : <Badge tone="gray">Off</Badge>}
                    </Td>
                    <Td className="tabular text-right">{money(s.price_per_ton_cents)}</Td>
                    <Td className="tabular text-right">{money(s.referral_fee_per_ton_cents)}</Td>
                    <Td className="text-right">
                      <div className="tabular">{t1(s.open_tons)} t</div>
                      {s.open_since ? <div className="text-xs text-muted" data-testid="open-age">waiting {days(s.open_since)}{s.open_needed_by ? `, needed by ${s.open_needed_by}` : ''}</div> : null}
                      {s.open_tons > 0 ? <Button size="sm" variant="ghost" className="mt-1" disabled={busy} data-testid="send-now" onClick={async () => { if (await ask({ title: `Send ${t1(s.open_tons)} tons to ${s.name} now?`, body: "It's short of a full truck. Check they'll run a partial load first.", confirm: 'Send now' })) void run(async () => { const r = await api<{ sent: number | null }>(`/api/admin/salt/suppliers/${s.id}`, { method: 'PATCH', body: { send_now: true } }); setMsg(r.sent ? `Sent ${r.sent} tons to ${s.name}. The companies in it were told.` : 'Nothing was waiting.'); }); }}>Send now</Button> : null}
                    </Td>
                    <Td className="tabular text-right">{t1(s.delivered_tons)} t</Td>
                    <Td className="tabular text-right">{money(s.fees_earned_cents)}</Td>
                    <Td className="tabular text-right">{money(s.fees_pending_cents)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" data-testid="supplier-copy" onClick={() => void copy(s)}>Copy link</Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`/api/admin/salt/suppliers/${s.id}`, { method: 'PATCH', body: { active: !s.active } }); setMsg(s.active ? `${s.name} is off: no new orders, and orders waiting on its shared load were cancelled and those companies told. Its link still works for loads it already has. Use New link to shut that too.` : `${s.name} is taking orders again.`); })}>{s.active ? 'Turn off' : 'Turn on'}</Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`/api/admin/salt/suppliers/${s.id}`, { method: 'PATCH', body: { new_link: true } }); setMsg(`New link for ${s.name}. The old one no longer works.`); })}>New link</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <p className="mt-2 text-sm text-muted">No suppliers yet. Add the first one below.</p>}
        {msg ? <p className="mt-2 break-all text-sm text-ink-2" role="status" data-testid="admin-msg">{msg}</p> : null}
      </Card>

      <Card>
        <h2 className="font-semibold">Add a supplier</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label htmlFor="s-name">Company</Label><Input id="s-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="s-name" /></div>
          <div><Label htmlFor="s-contact">Contact</Label><Input id="s-contact" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
          <div><Label htmlFor="s-email">Email for orders</Label><Input id="s-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="s-email" /></div>
          <div><Label htmlFor="s-phone">Phone</Label><Input id="s-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="s-address">Yard address (delivery distance is measured from here)</Label><Input id="s-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="s-address" /></div>
          <div><Label htmlFor="s-radius">Delivers within (miles)</Label><Input id="s-radius" type="number" value={f.radius_mi} onChange={(e) => setF({ ...f, radius_mi: e.target.value })} /></div>
          <div><Label htmlFor="s-price">Delivered price a ton ($)</Label><Input id="s-price" type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} data-testid="s-price" /></div>
          <div><Label htmlFor="s-truck">Truckload (tons)</Label><Input id="s-truck" type="number" value={f.truckload} onChange={(e) => setF({ ...f, truckload: e.target.value })} data-testid="s-truck" /></div>
          <div><Label htmlFor="s-stop">Stop fee on a shared load ($)</Label><Input id="s-stop" type="number" step="0.01" value={f.stop_fee} onChange={(e) => setF({ ...f, stop_fee: e.target.value })} /></div>
          <div><Label htmlFor="s-fee">Your referral fee a ton ($)</Label><Input id="s-fee" type="number" step="0.01" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} data-testid="s-fee" /></div>
        </div>
        <Button variant="accent" className="mt-4" disabled={busy || !f.name || !f.email || f.address.length < 5} data-testid="s-add" onClick={() => run(async () => {
          await api('/api/admin/salt/suppliers', { body: { name: f.name, contact_name: f.contact_name || null, email: f.email, phone: f.phone || null, address: f.address, radius_mi: Number(f.radius_mi), price_per_ton_cents: cents(f.price), truckload_tons: Number(f.truckload), stop_fee_cents: cents(f.stop_fee), referral_fee_per_ton_cents: cents(f.fee) } });
          setF(blank);
          setMsg('Supplier added. Copy their link and send it to them.');
        })}>Add supplier</Button>
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      </Card>

      <Card>
        <h2 className="font-semibold">Asked for salt where no supplier delivers</h2>
        <p className="mt-1 text-sm text-muted">Where to sign the next supplier.</p>
        {data.waitlist.length ? (
          <ul className="mt-2 space-y-1 text-sm" data-testid="waitlist">
            {data.waitlist.map((w, i) => <li key={i}>{w.tenant}: {w.tons} tons to {w.address} <span className="text-faint">({w.at.slice(0, 10)})</span></li>)}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">None yet.</p>}
      </Card>
    </div>
  );
}
