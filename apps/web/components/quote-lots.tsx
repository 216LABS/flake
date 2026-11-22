'use client';

import { Button } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import type { Share } from '@/lib/share';
import { CopyLink, TextIt } from './text-it';

interface Out { season: string; quoted: number; skipped: number; customers: { customer_id: string; name: string; url: string; share: Share; lots: number }[] }

/**
 * Quotes many lots at once at the rate card price (issue 217), link only, then lists each customer's one link to copy
 * or text from the office phone. For a list just imported, instead of a trip to every site page.
 */
export function QuoteLots({ siteIds, testId = 'quote-lots' }: { siteIds: string[]; testId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Out | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!siteIds.length && !out) return null;
  if (out) {
    return (
      <div className="mt-3" data-testid={`${testId}-done`}>
        <p className="text-sm font-semibold">{out.quoted === 1 ? '1 quote made' : `${out.quoted} quotes made`} for {out.season}{out.skipped ? `, ${out.skipped} skipped (already quoted)` : ''}. Nothing was sent.</p>
        <p className="mt-1 text-sm text-ink-2">Each customer has one link for all their lots. Send it from your phone, or change a price first on the lot&apos;s page.</p>
        <ul className="mt-2 divide-y divide-line-faint rounded-md border border-line-faint">
          {out.customers.map((c) => (
            <li key={c.customer_id} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid={`${testId}-row`}>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">{c.name}{c.lots > 1 ? <span className="font-normal text-muted"> ({c.lots} lots)</span> : null}</span>
              <CopyLink url={c.url} testId={`${testId}-copy`} />
              <TextIt share={c.share} testId={`${testId}-text`} />
            </li>
          ))}
        </ul>
        <Button className="mt-2" size="sm" variant="outline" data-testid={`${testId}-finished`} onClick={() => router.refresh()}>Done</Button>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <Button variant="accent" disabled={busy} data-testid={testId} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          // No refresh yet: the page around this box only shows it while a lot has no quote, so a refresh would take the
          // links away before anyone copies them (issue 240). Done refreshes.
          setOut(await api<Out>('/api/quotes/bulk', { body: { site_ids: siteIds } }));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Making quotes...' : `Quote ${siteIds.length === 1 ? 'this lot' : `all ${siteIds.length} lots`} at your rate card prices`}</Button>
      <p className="mt-1 text-xs text-muted">Per push, at the price your rate card gives each lot&apos;s size, with your usual trigger. Nothing is sent.</p>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
