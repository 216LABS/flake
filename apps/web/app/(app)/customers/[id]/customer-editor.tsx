'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function CustomerEditor({ customer }: { customer: { id: string; name: string; kind: string; contact_name: string | null; email: string | null; phone_e164: string | null; billing_mode: string } }) {
  const router = useRouter();
  const [f, setF] = useState({ name: customer.name, kind: customer.kind, contact_name: customer.contact_name ?? '', email: customer.email ?? '', phone_e164: customer.phone_e164 ?? '', billing_mode: customer.billing_mode });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = (key: 'name' | 'contact_name' | 'email' | 'phone_e164', label: string) => (
    <div><Label htmlFor={key}>{label}</Label><Input id={key} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></div>
  );
  return (
    <Card>
      <h2 className="font-semibold">Details</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {text('name', 'Name')}
        {text('contact_name', 'Contact')}
        {text('email', 'Email')}
        {text('phone_e164', 'Mobile')}
        <div><Label htmlFor="kind">Kind</Label><Select id="kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="hoa">HOA</option></Select></div>
        <div><Label htmlFor="billing">Billing</Label><Select id="billing" value={f.billing_mode} onChange={(e) => setF({ ...f, billing_mode: e.target.value })}><option value="card_on_file">Card on file</option><option value="ach_on_file">Bank (ACH) on file</option><option value="invoice_net30">Net-30 invoice</option><option value="manual">Manual</option></Select></div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy || !f.name.trim()} data-testid="customer-save" onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/customers/${customer.id}`, { method: 'PATCH', body: f });
            setMsg('Saved');
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Save</Button>
        {msg ? <span className="text-sm text-slate-600" data-testid="customer-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}
