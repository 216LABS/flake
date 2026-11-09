'use client';

import { Button, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

/** Set a delivery date, or mark the load delivered with what actually went on the ground. */
export function StopActions({ token, id, status, tons, deliveryDate }: { token: string; id: string; status: string; tons: number; deliveryDate: string | null }) {
  const router = useRouter();
  const [date, setDate] = useState(deliveryDate ?? '');
  const [delivered, setDelivered] = useState(String(tons));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status === 'delivered') return null;
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/supplier/${token}/orders/${id}`, { body });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div><Label htmlFor={`d-${id}`}>Delivery date</Label><Input id={`d-${id}`} type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} data-testid="supplier-date" /></div>
      <Button size="sm" variant="outline" disabled={busy || !date} data-testid="supplier-schedule" onClick={() => void send({ delivery_date: date })}>{status === 'scheduled' ? 'Change date' : 'Set date'}</Button>
      <div><Label htmlFor={`t-${id}`}>Tons delivered</Label><Input id={`t-${id}`} type="number" step="0.1" className="h-9 w-28" value={delivered} onChange={(e) => setDelivered(e.target.value)} data-testid="supplier-tons" /></div>
      <Button size="sm" disabled={busy || !Number(delivered)} data-testid="supplier-delivered" onClick={() => void send({ delivered_tons: Number(delivered) })}>Mark delivered</Button>
      {error ? <p className="w-full text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
