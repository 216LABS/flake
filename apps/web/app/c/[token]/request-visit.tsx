'use client';

import { Button, Card, Label, Select, Textarea } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

/** A lot drifted back in, or a delivery is coming early. The office hears about it right away. */
export function RequestVisit({ token, company, sites }: { token: string; company: string; sites: { id: string; label: string }[] }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (!sites.length) return null;
  return (
    <Card data-testid="request-visit">
      <h2 className="font-semibold">Need us back?</h2>
      {state === 'sent' ? (
        <p className="mt-2 text-sm" role="status" data-testid="request-sent">Sent. {company} has your request and will be in touch.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Ask for another visit. Your request goes straight to {company}'s office.</p>
          {sites.length > 1 ? (
            <div className="mt-3"><Label htmlFor="req-site">Which lot</Label><Select id="req-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
          ) : null}
          <div className="mt-3"><Label htmlFor="req-note">Anything they should know (optional)</Label><Textarea id="req-note" maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Drifting by the loading dock" data-testid="request-note" /></div>
          <Button variant="accent" className="mt-3 w-full" disabled={state === 'sending'} data-testid="request-send" onClick={async () => {
            setState('sending');
            setError(null);
            try {
              await api(`/api/c/${token}/request`, { body: { site_id: siteId, note: note.trim() || undefined } });
              setState('sent');
            } catch (e) {
              setError((e as Error).message);
              setState('idle');
            }
          }}>Request a visit</Button>
          {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
        </>
      )}
    </Card>
  );
}
