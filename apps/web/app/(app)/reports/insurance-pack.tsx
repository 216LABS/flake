'use client';

import { Eyebrow, Input, Label } from '@flake/ui';
import { useState } from 'react';
import { ButtonA } from '@/components/links';
import { ShareButton, ShareList } from '@/components/share-button';

/**
 * Reports, Insurance (issue 236): the renewal pack an agent and underwriter want at renewal, across every lot, as a
 * PDF or CSV, shared by an expiring link if you like. Plus every share link and how often it was opened.
 */
export function InsurancePack({ from, to, canShare }: { from: string; to: string; canShare: boolean }) {
  const [f, setF] = useState({ from, to });
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(f.from) && /^\d{4}-\d{2}-\d{2}$/.test(f.to) && f.to >= f.from;
  const q = `from=${f.from}&to=${f.to}`;
  return (
    <section className="mb-8" data-testid="insurance-pack">
      <Eyebrow className="mb-2">Insurance</Eyebrow>
      <p className="max-w-2xl text-sm text-ink-2">The renewal pack: storms, visits, how many had GPS, photos and depth, salt, salt runs, how fast trucks reached lots after an alert, your certificate on file and claims, then a table per lot. Agents and underwriters ask for this at renewal.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div><Label htmlFor="ins-from">From</Label><Input id="ins-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="ins-from" /></div>
        <div><Label htmlFor="ins-to">To</Label><Input id="ins-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="ins-to" /></div>
        {ok ? <><ButtonA href={`/api/insurance/pack?${q}`} download data-testid="ins-pdf">Renewal pack (PDF)</ButtonA><ButtonA href={`/api/insurance/pack?${q}&format=csv`} download data-testid="ins-csv">CSV</ButtonA></> : null}
        {ok && canShare ? <ShareButton kind="renewal" from={f.from} to={f.to} testId="ins-share" /> : null}
      </div>
      <ShareList canEdit={canShare} />
    </section>
  );
}
