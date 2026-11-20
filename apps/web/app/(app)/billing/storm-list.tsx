import { cn } from '@flake/ui';
import Link from 'next/link';
import { money } from '@/lib/client';

export interface StormSummary { id: string; name: string; when: string; status: string; review: number; waiting_cents: number; bills: number }

const STATUS_WORD: Record<string, string> = { active: 'Live', closed: 'Ready to bill', billed: 'Billed' };

/**
 * Storms as a list with what's waiting in each (issue 195), instead of a dropdown that opened the newest storm even when
 * it was live with nothing in it. To bill first; billed ones after. On a phone it's a row you swipe across.
 */
export function StormList({ storms, selected }: { storms: StormSummary[]; selected: string }) {
  const toBill = storms.filter((s) => s.status !== 'billed');
  const billed = storms.filter((s) => s.status === 'billed');
  const row = (s: StormSummary) => (
    <li key={s.id} className="shrink-0 max-lg:w-60">
      <Link href={`/billing?storm=${s.id}`} aria-current={s.id === selected ? 'page' : undefined} data-testid="storm-row" data-status={s.status}
        className={cn('block rounded-control border p-3 text-sm transition-colors hover:border-ink', s.id === selected ? 'border-ink bg-surface shadow-drop' : 'border-line-faint bg-surface')}>
        <span className="block font-semibold text-ink">{s.name}</span>
        <span className="block text-xs text-muted">{s.when} · {STATUS_WORD[s.status] ?? s.status}</span>
        <span className={cn('mt-1 block text-xs font-medium', s.review ? 'text-warn-ink' : 'text-muted')} data-testid="storm-row-summary">
          {s.review ? `${s.review} ${s.review === 1 ? 'bill' : 'bills'}, ${money(s.waiting_cents)} waiting` : s.bills ? `${s.bills} ${s.bills === 1 ? 'bill' : 'bills'}, none waiting` : s.status === 'active' ? 'Running now' : 'No bills yet'}
        </span>
      </Link>
    </li>
  );
  return (
    <nav aria-label="Storms" className="mb-4 lg:mb-0" data-testid="storm-list">
      {toBill.length ? <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">To bill</h2> : null}
      <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">{toBill.map(row)}</ul>
      {billed.length ? (
        <details className="mt-2" open={billed.some((s) => s.id === selected)}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted">Billed ({billed.length})</summary>
          <ul className="mt-1 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">{billed.map(row)}</ul>
        </details>
      ) : null}
    </nav>
  );
}
