'use client';

import { Button } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';

/** Records a seasonal installment paid by check or cash. */
export function InstallmentPaid({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {dialog}
      <Button size="sm" variant="outline" disabled={busy} data-testid="installment-paid" onClick={async () => {
        if (!(await ask({ title: `Mark ${label} paid?`, body: 'For a check, cash or other payment you already have.', confirm: 'Mark paid' }))) return;
        setBusy(true);
        setError(null);
        try {
          await api(`/api/installments/${id}/paid`, { method: 'POST' });
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>Mark paid</Button>
      {error ? <span className="block text-xs text-danger" role="alert">{error}</span> : null}
    </>
  );
}
