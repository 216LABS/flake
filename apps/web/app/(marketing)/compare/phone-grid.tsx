'use client';

import { Segmented } from '@flake/ui';
import { useState } from 'react';
import { PRICES, PRODUCTS, type Product, ROWS } from '@/lib/compare';
import { CellView } from './cell';

type Other = Exclude<Product, 'Flake'>;
const OTHERS = PRODUCTS.filter((p): p is Other => p !== 'Flake');

/** Phones: Flake beside one other product at a time, since five columns can't fit at 390 px (issue 181). */
export function PhoneGrid() {
  const [other, setOther] = useState<Other>('Jobber');
  return (
    <div className="md:hidden" data-testid="compare-phone">
      <div className="sticky top-0 z-10 -mx-4 bg-tint px-4 pb-2 pt-2">
        <Segmented label="Compare Flake with" name="compare-with" value={other} options={OTHERS.map((p) => [p, p] as const)} onChange={setOther} testId="compare-pick" />
      </div>
      <ul className="mt-2 space-y-2">
        {ROWS.map((r) => (
          <li key={r.feature} className="rounded-md border border-line-faint bg-surface p-3" data-testid="compare-row">
            <p className="font-semibold text-ink">{r.feature}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Flake</p><CellView className="mt-1" cell={r.cells.Flake} /></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{other}</p><CellView className="mt-1" cell={r.cells[other]} /></div>
            </div>
          </li>
        ))}
        <li className="rounded-md border border-line-faint bg-surface p-3">
          <p className="font-semibold text-ink">Published price</p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs leading-snug text-ink-2">
            <div><p className="font-semibold uppercase tracking-wide text-muted">Flake</p><p className="mt-1">{PRICES.Flake}</p></div>
            <div><p className="font-semibold uppercase tracking-wide text-muted">{other}</p><p className="mt-1">{PRICES[other]}</p></div>
          </div>
        </li>
      </ul>
    </div>
  );
}
