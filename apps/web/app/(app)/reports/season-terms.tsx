'use client';

import { Button, Eyebrow, Table, Td, Th } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, money } from '@/lib/client';
import type { SeasonTermRow } from '@/lib/season-terms';

/** Pushes used against a seasonal cap, and billing against a seasonal minimum, so far this season (issue 233). */
export function SeasonTerms({ season, rows, owner }: { season: string; rows: SeasonTermRow[]; owner: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return null;
  const act = async (body: unknown) => {
    setError(null);
    try {
      await api('/api/season/trueup', { body });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="mb-8" data-testid="season-terms">
      <Eyebrow className="mb-2">Season {season}: caps and minimums</Eyebrow>
      <Table stack>
        <thead><tr><Th>Lot</Th><Th>Pushes</Th><Th>Billed</Th><Th>Minimum</Th><Th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const short = r.minimum_cents ? r.minimum_cents - r.billed_cents : 0;
            return (
              <tr key={r.contract_id} data-testid="season-term-row">
                <Td><span className="font-medium">{r.site}</span><span className="block text-xs text-muted">{r.customer}</span></Td>
                <Td label="Pushes" className="tabular">{r.included ? <span className={r.pushes > r.included ? 'font-semibold text-warn-ink' : undefined}>{r.pushes} of {r.included} included</span> : r.pushes}</Td>
                <Td label="Billed" className="tabular">{money(r.billed_cents)}</Td>
                <Td label="Minimum" className="tabular">{r.minimum_cents ? <>{money(r.minimum_cents)}{short > 0 ? <span className="block text-xs text-warn-ink">{money(short)} short so far</span> : <span className="block text-xs text-ok-ink">Met</span>}</> : '-'}</Td>
                <Td>
                  {owner && r.minimum_cents && short > 0 && !r.trueup ? <Button size="sm" variant="outline" data-testid="trueup-draft" onClick={() => void act({ action: 'draft', contract_id: r.contract_id })}>Draft true-up of {money(short)}</Button> : null}
                  {r.trueup?.status === 'draft' ? (
                    <span className="flex flex-wrap items-center gap-1 text-sm" data-testid="trueup-drafted">True-up {money(r.trueup.amount_cents)} drafted, not sent.
                      {owner ? <><Button size="sm" data-testid="trueup-approve" onClick={() => void act({ action: 'approve', id: r.trueup!.id })}>Approve</Button><Button size="sm" variant="ghost" data-testid="trueup-discard" onClick={() => void act({ action: 'discard', id: r.trueup!.id })}>Discard</Button></> : null}
                    </span>
                  ) : r.trueup ? <span className="text-sm text-muted" data-testid="trueup-billed">True-up {money(r.trueup.amount_cents)} billed. It&apos;s on Receivables.</span> : null}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-muted">Pushes are finished plow visits this season. A true-up is only drafted when you press it, and nobody sees it until you approve it.</p>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    </section>
  );
}
