'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';

export function CustomerEditor({ customer }: { customer: { id: string; name: string; kind: string; contact_name: string | null; email: string | null; phone_e164: string | null; billing_mode: string } }) {
  const router = useRouter();
  const [f, setF] = useState({ name: customer.name, kind: customer.kind, contact_name: customer.contact_name ?? '', email: customer.email ?? '', phone_e164: customer.phone_e164 ?? '', billing_mode: customer.billing_mode });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const text = (key: 'name' | 'contact_name' | 'email' | 'phone_e164', label: string, type = 'text') => (
    <div><Label htmlFor={key}>{label}</Label><Input id={key} type={type} maxLength={200} value={f[key]} onChange={(e) => { setMsg(null); setF({ ...f, [key]: e.target.value }); }} /></div>
  );
  const problem = customerProblem(f);
  return (
    <Card>
      <h2 className="font-semibold">Details</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {text('name', 'Name')}
        {text('contact_name', 'Contact')}
        {text('email', 'Email', 'email')}
        {text('phone_e164', 'Mobile', 'tel')}
        <div><Label htmlFor="kind">Kind</Label><Select id="kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="hoa">HOA</option></Select></div>
        <div><Label htmlFor="billing">Billing</Label><Select id="billing" value={f.billing_mode} onChange={(e) => setF({ ...f, billing_mode: e.target.value })}><option value="card_on_file">Card on file</option><option value="ach_on_file">Bank (ACH) on file</option><option value="invoice_net30">Net-30 invoice</option><option value="manual">Manual</option></Select></div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy} data-testid="customer-save" onClick={async () => {
          if (problem) return setMsg({ ok: false, text: problem });
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/customers/${customer.id}`, { method: 'PATCH', body: { ...f, name: f.name.trim(), phone_e164: toE164(f.phone_e164) } });
            setMsg({ ok: true, text: 'Saved' });
            router.refresh();
          } catch (e) {
            setMsg({ ok: false, text: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}>Save</Button>
        {msg ? <span className={msg.ok ? 'text-sm font-medium text-ok-ink' : 'text-sm text-danger'} role={msg.ok ? 'status' : 'alert'} data-testid="customer-msg">{msg.text}</span> : null}
      </div>
    </Card>
  );
}

/** (216) 555-0101, 216-555-0101 and +12165550101 all mean the same US mobile. Anything else is sent as typed. */
export function toE164(v: string): string {
  const t = v.trim();
  if (!t) return '';
  const digits = t.replace(/\D/g, '');
  if (!t.startsWith('+') && digits.length === 10) return `+1${digits}`;
  if (!t.startsWith('+') && digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return t.startsWith('+') ? `+${digits}` : t;
}

/** The same rules the server checks, said in words before anything is sent (issue 5). */
export function customerProblem(f: { name: string; email: string; phone_e164: string }): string | null {
  if (!f.name.trim()) return 'Enter a name.';
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'That email address doesn\'t look right.';
  if (f.phone_e164.trim() && !/^\+[1-9]\d{7,14}$/.test(toE164(f.phone_e164))) return 'Enter a 10-digit US mobile phone number, like (216) 555-0101.';
  return null;
}

export function ArchiveCustomer({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {dialog}
      <Button variant="outline" data-testid={archived ? 'restore-customer' : 'archive-customer'} onClick={async () => {
        if (!archived && !(await ask({ title: `Archive ${name}?`, body: 'Their sites are retired: they come off routes, any storm still running, and seasonal billing. Their visits, invoices and records stay on file. You can restore the customer later, and then each site.', confirm: 'Archive customer', danger: true }))) return;
        setError(null);
        try {
          await api(`/api/customers/${id}`, { method: 'PATCH', body: { archived: !archived } });
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        }
      }}>{archived ? 'Restore customer' : 'Archive'}</Button>
      {error ? <p className="w-full text-sm text-danger" role="alert">{error}</p> : null}
    </>
  );
}
