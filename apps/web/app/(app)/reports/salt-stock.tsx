'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

type Entry = { id: string; kind: 'delivery' | 'count'; tons: number; note?: string; when: string };

/** Log a delivery, or count the pile to set stock exactly. */
export function SaltStockForm({ canEdit, entries }: { canEdit: boolean; entries: Entry[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<'delivery' | 'count'>('delivery');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    const tons = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(tons) || tons < 0) return setError('Enter the tons as a number.');
    setBusy(true);
    try {
      await api('/api/reports/salt', { body: { kind, tons, note: note || undefined } });
      setAmount('');
      setNote('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setError('');
    try {
      await api(`/api/reports/salt?id=${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card>
      {canEdit ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="salt-kind">What happened</Label>
            <Select id="salt-kind" data-testid="salt-kind" value={kind} onChange={(e) => setKind(e.target.value as 'delivery' | 'count')}>
              <option value="delivery">Salt delivered</option>
              <option value="count">Counted the pile</option>
            </Select>
          </div>
          <div className="w-28"><Label htmlFor="salt-tons">Tons</Label><Input id="salt-tons" data-testid="salt-tons" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="min-w-48 flex-1"><Label htmlFor="salt-note">Note (optional)</Label><Input id="salt-note" value={note} maxLength={200} placeholder="Supplier, ticket number" onChange={(e) => setNote(e.target.value)} /></div>
          <Button onClick={save} disabled={busy} data-testid="salt-save">{busy ? 'Saving' : 'Save'}</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-3 text-sm text-red-700">{error}</p> : null}
      {entries.length ? (
        <ul className="divide-y divide-slate-100 text-sm" data-testid="salt-entries">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span><span className="font-semibold">{e.kind === 'delivery' ? `+${e.tons} t delivered` : `Counted ${e.tons} t`}</span> <span className="text-slate-600">{e.when}{e.note ? `, ${e.note}` : ''}</span></span>
              {canEdit ? <Button variant="ghost" size="sm" onClick={() => remove(e.id)} aria-label={`Remove ${e.kind} from ${e.when}`}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-600">No deliveries or counts yet.</p>}
    </Card>
  );
}
