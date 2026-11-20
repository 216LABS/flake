'use client';

import { Badge, Button, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { ButtonA, ButtonLink, entityLink } from '@/components/links';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, dollarsToCents, money } from '@/lib/client';

interface Row { kind: 'draft' | 'installment'; id: string; customer_id: string; customer: string; label: string; storm_id: string | null; status: string; total_cents: number; paid_cents: number; balance_cents: number; due_on: string; days_late: number; bucket: string }

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function ReceivablesTable({ rows, today, readOnly }: { rows: Row[]; today: string; readOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: '', method: 'check', reference: '', paid_on: today, due: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; sms?: string } | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sms = (phone: string | null, text: string) => `sms:${phone ?? ''}${typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
  return (
    <div className="max-w-5xl">
      {error ? <p className="mb-2 text-sm text-danger" role="alert" data-testid="receivables-error">{error}</p> : null}
      <Table stack>
        <thead><tr><Th>Customer</Th><Th>Bill</Th><Th className="text-right">Left</Th><Th>Due</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="receivable-row">
              <Td><Link className={`${entityLink} wrap-anywhere`} href={`/customers/${r.customer_id}`}>{r.customer}</Link></Td>
              <Td label="Bill" className="wrap-anywhere">
                {r.storm_id ? <Link className={entityLink} href={`/billing?storm=${r.storm_id}`}>{r.label}</Link> : r.label}
                <span className="block text-xs text-muted">{money(r.total_cents)}{r.paid_cents ? `, ${money(r.paid_cents)} paid` : ''}</span>
              </Td>
              <Td label="Left" className="text-right tabular font-semibold" data-testid="receivable-left">{money(r.balance_cents)}</Td>
              <Td label="Due">{day(r.due_on)} {r.days_late > 0 ? <Badge tone={r.days_late > 60 ? 'red' : 'amber'} data-testid="receivable-late">{r.days_late} {r.days_late === 1 ? 'day' : 'days'} late</Badge> : <Badge tone="gray">Not due</Badge>}</Td>
              <Td>
                {!readOnly ? (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" data-testid="record-payment" onClick={() => { setOpen(open === r.id ? null : r.id); setForm({ ...form, amount: (r.balance_cents / 100).toFixed(2), due: r.due_on }); }}>Payment</Button>
                    {r.days_late > 0 ? <Button size="sm" variant="ghost" disabled={busy} data-testid="send-reminder" onClick={() => run(async () => {
                      const out = await api<{ sent: boolean; to: string | null; phone: string | null; text: string }>('/api/receivables', { body: { action: 'remind', customer_id: r.customer_id } });
                      setNote(out.sent ? { id: r.id, text: `Reminder texted to ${out.to}.` } : { id: r.id, text: 'They have not said yes to texts from you, so send it from your own phone:', sms: sms(out.phone, out.text) });
                    })}>Reminder</Button> : null}
                    <ButtonLink size="sm" href={`/customers/${r.customer_id}/statement`} data-testid="open-statement">Statement</ButtonLink>
                  </div>
                ) : null}
                {note?.id === r.id ? <p className="mt-1 text-xs" role="status" data-testid="reminder-note">{note.text} {note.sms ? <ButtonA size="sm" className="mt-1" href={note.sms} data-testid="reminder-sms">Text from my phone</ButtonA> : null}</p> : null}
                {open === r.id ? (
                  <div className="mt-2 grid gap-2 rounded-md border border-line-faint p-2 sm:grid-cols-2" data-testid="payment-form">
                    <div><Label htmlFor={`amt-${r.id}`}>Amount ($)</Label><Input id={`amt-${r.id}`} type="number" inputMode="decimal" min={0.01} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="payment-amount" /></div>
                    <div><Label htmlFor={`m-${r.id}`}>How</Label><Select id={`m-${r.id}`} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="check">Check</option><option value="ach">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option></Select></div>
                    <div><Label htmlFor={`ref-${r.id}`}>Check or reference no.</Label><Input id={`ref-${r.id}`} maxLength={100} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} data-testid="payment-ref" /></div>
                    <div><Label htmlFor={`on-${r.id}`}>Received</Label><Input id={`on-${r.id}`} type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button size="sm" disabled={busy || !(Number(form.amount) > 0)} data-testid="payment-save" onClick={() => run(async () => {
                        await api('/api/payments', { body: { kind: r.kind, id: r.id, amount_cents: dollarsToCents(form.amount), method: form.method, reference: form.reference || null, paid_on: form.paid_on } });
                        setOpen(null);
                      })}>Record payment</Button>
                      <span className="flex items-end gap-1">
                        <span><Label htmlFor={`due-${r.id}`}>Due date</Label><Input id={`due-${r.id}`} type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} data-testid="due-input" /></span>
                        <Button size="sm" variant="outline" disabled={busy || !form.due} data-testid="due-save" onClick={() => run(async () => { await api('/api/receivables', { body: { action: 'due', kind: r.kind, id: r.id, due_on: form.due } }); setOpen(null); })}>Set due date</Button>
                      </span>
                    </div>
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
