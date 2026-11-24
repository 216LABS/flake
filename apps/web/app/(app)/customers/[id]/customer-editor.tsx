'use client';

import { Button, buttonVariants, Card, Input, Label, Segmented, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, phone } from '@/lib/client';
import { billingLabel } from '@/lib/labels';

const KIND_WORD: Record<string, string> = { commercial: 'Commercial', residential: 'Residential', hoa: 'HOA' };

/**
 * A customer's details. People open a customer to look them up or call them far more often than to change them, so the
 * card reads first and turns into a form on Edit (UX pass, Nov 23).
 */
export function CustomerEditor({ customer, canEdit = true }: { customer: { id: string; name: string; kind: string; contact_name: string | null; email: string | null; phone_e164: string | null; billing_mode: string }; canEdit?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: customer.name, kind: customer.kind, contact_name: customer.contact_name ?? '', email: customer.email ?? '', phone_e164: phone(customer.phone_e164), billing_mode: customer.billing_mode });
  // What the server had when this form loaded or last saved. Only changed fields are sent, with what they were, so a
  // second tab can't overwrite edits it never saw (issue 144).
  const [base, setBase] = useState(() => ({ name: customer.name, kind: customer.kind, contact_name: customer.contact_name, email: customer.email, phone_e164: customer.phone_e164, billing_mode: customer.billing_mode }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const text = (key: 'name' | 'contact_name' | 'email' | 'phone_e164', label: string, type = 'text') => (
    <div><Label htmlFor={key}>{label}</Label><Input id={key} type={type} maxLength={200} value={f[key]} onChange={(e) => { setMsg(null); setF({ ...f, [key]: e.target.value }); }} /></div>
  );
  const problem = customerProblem(f);
  if (!editing) {
    const row = (label: string, value: ReactNode, testId?: string) => (
      <div className="flex justify-between gap-3 py-2 sm:block sm:py-0"><dt className="text-sm text-muted">{label}</dt><dd className="min-w-0 text-right font-medium wrap-anywhere sm:text-left" data-testid={testId}>{value}</dd></div>
    );
    return (
      <Card data-testid="customer-details">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Details</h2>
          {canEdit ? <Button size="sm" variant="outline" data-testid="customer-edit" onClick={() => { setMsg(null); setEditing(true); }}>Edit</Button> : null}
        </div>
        <dl className="mt-2 divide-y divide-line-faint sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-3 sm:divide-y-0">
          {row('Name', base.name, 'customer-name')}
          {row('Contact', base.contact_name || <span className="font-normal text-muted">None</span>)}
          {row('Mobile', base.phone_e164 ? <a className="underline-offset-2 hover:underline" href={`tel:${base.phone_e164}`}>{phone(base.phone_e164)}</a> : <span className="font-normal text-muted">None</span>)}
          {row('Email', base.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${base.email}`}>{base.email}</a> : <span className="font-normal text-muted">None</span>)}
          {row('Kind', KIND_WORD[base.kind] ?? base.kind)}
          {row('Billing', billingLabel(base.billing_mode))}
        </dl>
        {/* Reach them in one tap: what the office usually opens a customer for on a storm night. */}
        {base.phone_e164 || base.email ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line-faint pt-3" data-testid="customer-contact">
            {base.phone_e164 ? <a href={`tel:${base.phone_e164}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="customer-call">Call</a> : null}
            {base.phone_e164 ? <a href={`sms:${base.phone_e164}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="customer-text">Text</a> : null}
            {base.email ? <a href={`mailto:${base.email}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="customer-email">Email</a> : null}
          </div>
        ) : null}
        {msg?.ok ? <p className="mt-2 text-sm font-medium text-ok-ink" role="status" data-testid="customer-msg">{msg.text}</p> : null}
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="font-semibold">Edit details</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {text('name', 'Name')}
        {text('contact_name', 'Contact')}
        {text('email', 'Email', 'email')}
        {text('phone_e164', 'Mobile', 'tel')}
        <Segmented label="Kind" name="kind" testId="kind" value={f.kind as 'commercial' | 'residential' | 'hoa'} options={[['commercial', 'Commercial'], ['residential', 'Residential'], ['hoa', 'HOA']] as const} onChange={(kind) => setF({ ...f, kind })} />
        <div><Label htmlFor="billing">Billing</Label><Select id="billing" value={f.billing_mode} onChange={(e) => setF({ ...f, billing_mode: e.target.value })}><option value="card_on_file">Card on file</option><option value="ach_on_file">Bank (ACH) on file</option><option value="invoice_net30">Net-30 invoice</option><option value="manual">Manual</option></Select></div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy} data-testid="customer-save" onClick={async () => {
          if (problem) return setMsg({ ok: false, text: problem });
          setBusy(true);
          setMsg(null);
          try {
            const next = { ...f, name: f.name.trim(), contact_name: f.contact_name.trim() || null, email: f.email.trim() || null, phone_e164: toE164(f.phone_e164) || null };
            const keys = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (next[k] ?? null) !== (base[k] ?? null));
            if (!keys.length) {
              setEditing(false);
              return setMsg({ ok: true, text: 'Saved' });
            }
            const saved = await api<typeof base>(`/api/customers/${customer.id}`, { method: 'PATCH', body: { ...Object.fromEntries(keys.map((k) => [k, next[k] ?? ''])), expected: Object.fromEntries(keys.map((k) => [k, base[k] ?? null])) } });
            // The form shows the saved row, so fields this tab didn't touch pick up another tab's changes too (issue 164).
            // Otherwise the next save would send a field the tab never changed, as stale, and undo the other edit.
            setBase({ name: saved.name, kind: saved.kind, contact_name: saved.contact_name, email: saved.email, phone_e164: saved.phone_e164, billing_mode: saved.billing_mode });
            setF({ name: saved.name, kind: saved.kind, contact_name: saved.contact_name ?? '', email: saved.email ?? '', phone_e164: phone(saved.phone_e164), billing_mode: saved.billing_mode });
            setMsg({ ok: true, text: 'Saved' });
            setEditing(false);
            router.refresh();
          } catch (e) {
            setMsg({ ok: false, text: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}>Save</Button>
        <Button variant="ghost" disabled={busy} data-testid="customer-cancel" onClick={() => { setF({ name: base.name, kind: base.kind, contact_name: base.contact_name ?? '', email: base.email ?? '', phone_e164: phone(base.phone_e164), billing_mode: base.billing_mode }); setMsg(null); setEditing(false); }}>Cancel</Button>
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
        if (!archived && !(await ask({ title: `Archive ${name}?`, body: 'Their sites are retired: they come off routes, any storm still running, and seasonal billing. Their visits, invoices and records stay on file. Restoring the customer later brings these sites back too. Unsigned quotes for them are withdrawn.', confirm: 'Archive customer', danger: true }))) return;
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
