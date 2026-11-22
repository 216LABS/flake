'use client';

import { Button, Input, Select } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { CopyLink } from './text-it';

/**
 * Share a proof packet or the renewal pack with an agent, adjuster or attorney (issue 236): an expiring link, copied
 * by the office. Nothing is sent from Flake.
 */
export function ShareButton({ kind, proofPacketId, from, to, testId = 'share-open' }: { kind: 'proof' | 'renewal'; proofPacketId?: string; from?: string; to?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="outline" data-testid={testId} onClick={() => setOpen(true)}>Share a link</Button>;
  return (
    <div className="mt-2 rounded-md border border-line-faint bg-surface p-2 text-sm" data-testid="share-form">
      {url ? (
        <>
          <p>Anyone with this link can open {kind === 'proof' ? 'this packet' : 'this pack'} until it expires. You can turn it off below.</p>
          <Input readOnly className="mt-1" value={url} onFocus={(e) => e.currentTarget.select()} data-testid="share-url" />
          <CopyLink url={url} className="mt-1" testId="share-copy" />
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="block text-xs font-medium" htmlFor={`sh-who-${testId}`}>For (optional)</label><Input id={`sh-who-${testId}`} placeholder="Agent at Erie Insurance" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><label className="block text-xs font-medium" htmlFor={`sh-days-${testId}`}>Works for</label><Select id={`sh-days-${testId}`} value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></Select></div>
          <Button size="sm" data-testid="share-make" onClick={async () => {
            setError(null);
            try {
              const out = await api<{ url: string }>('/api/share', { body: { kind, proof_packet_id: proofPacketId, from, to, days: Number(days), label: label || undefined } });
              setUrl(out.url);
            } catch (e) {
              setError((e as Error).message);
            }
          }}>Make link</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
      {error ? <p className="mt-1 text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

interface Link { id: string; kind: string; label: string | null; params: { from?: string; to?: string }; expires_at: string; revoked_at: string | null; created_at: string; live: boolean; opens: number; last_open: string | null; url: string | null }

/** Every share link, whether it still works, how often it was opened, and Turn off. */
export function ShareList({ canEdit, refresh = 0 }: { canEdit: boolean; refresh?: number }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ links: Link[] }>('/api/share').then((o) => setLinks(o.links), (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [refresh]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!links?.length) return null;
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <ul className="mt-3 divide-y divide-line-faint rounded-md border border-line-faint text-sm" data-testid="share-list">
      {links.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 p-2" data-testid="share-row" data-live={l.live ? 'yes' : 'no'}>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{l.kind === 'proof' ? 'Proof packet' : `Renewal pack ${l.params.from} to ${l.params.to}`}</span>{l.label ? `, ${l.label}` : ''}
            <span className="block text-xs text-muted">{l.revoked_at ? 'Turned off' : l.live ? `Works until ${day(l.expires_at)}` : 'Expired'}. Opened {l.opens === 1 ? 'once' : `${l.opens} times`}{l.last_open ? `, last ${day(l.last_open)}` : ''}.</span>
          </span>
          {canEdit && l.live ? <Button size="sm" variant="ghost" data-testid="share-revoke" onClick={async () => { await api(`/api/share/${l.id}/revoke`, { method: 'POST' }); void load(); }}>Turn off</Button> : null}
        </li>
      ))}
    </ul>
  );
}
