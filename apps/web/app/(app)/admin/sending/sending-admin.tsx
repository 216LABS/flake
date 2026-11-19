'use client';

import { Badge, Button, Card, Input, Table, Td, Th } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';

interface Row { id: string; name: string; slug: string; created_at: string; outbound_enabled: boolean; outbound_changed_at: string | null; outbound_changed_by: string | null; sms_status: string | null; owner: string | null }

export function SendingAdmin({ rows, tz }: { rows: Row[]; tz: string }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = rows.filter((r) => !q.trim() || `${r.name} ${r.slug} ${r.owner ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <Card className="max-w-5xl">
      {dialog}
      <p className="text-sm" data-testid="sending-count">{rows.filter((r) => r.outbound_enabled).length} of {rows.length} companies sending.</p>
      <Input aria-label="Find a company" placeholder="Find a company or owner" className="mt-2 max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sending-search" />
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      <Table stack className="mt-3">
        <thead><tr><Th>Company</Th><Th>Owner</Th><Th>Sending</Th><Th /></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} data-testid="sending-row">
              <Td className="wrap-anywhere"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.slug}</span></Td>
              <Td label="Owner" className="wrap-anywhere">{r.owner ?? '-'}</Td>
              <Td label="Sending"><Badge tone={r.outbound_enabled ? 'green' : 'gray'} data-testid="sending-state">{r.outbound_enabled ? 'On' : 'Off'}</Badge>{r.outbound_changed_at ? <span className="block text-xs text-muted">{when(r.outbound_changed_at)} by {r.outbound_changed_by}</span> : null}</Td>
              <Td>
                <Button size="sm" variant={r.outbound_enabled ? 'outline' : 'accent'} disabled={busy !== null} data-testid="sending-toggle" onClick={async () => {
                  const on = !r.outbound_enabled;
                  if (on && !(await ask({ title: `Turn sending on for ${r.name}?`, body: 'Bills, quotes and notices from this company will reach real inboxes and phones. Other companies stay off.', confirm: 'Turn on' }))) return;
                  setBusy(r.id);
                  setError(null);
                  try {
                    await api('/api/admin/outbound', { method: 'PATCH', body: { tenant_id: r.id, enabled: on } });
                    router.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}>{r.outbound_enabled ? 'Turn off' : 'Turn on'}</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
