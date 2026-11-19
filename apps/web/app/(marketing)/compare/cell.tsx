import { cn } from '@flake/ui';
import { type Cell, LABEL } from '@/lib/compare';

/**
 * One grid cell. Only Yes gets a check. No is a dash. Partial, Add-on and Unverified are words, so none of them can be
 * read as a check (issue 181).
 */
export function CellView({ cell, className }: { cell: Cell; className?: string }) {
  const mark =
    cell.v === 'yes' ? <span className="inline-flex items-center gap-1 font-semibold text-ok-ink"><span aria-hidden="true">✓</span>Yes</span>
    : cell.v === 'no' ? <span className="inline-flex items-center gap-1 text-muted"><span aria-hidden="true">–</span>No</span>
    : cell.v === 'unverified' ? <span className="rounded-sm border border-dashed border-line-strong px-1.5 py-0.5 text-xs text-muted">Unverified</span>
    : <span className="rounded-sm bg-warn-tint px-1.5 py-0.5 text-xs font-semibold text-warn-ink">{LABEL[cell.v]}</span>;
  return (
    <div className={cn('text-sm', className)} data-testid="compare-cell" data-value={cell.v}>
      {mark}
      {cell.note ? <p className="mt-1 text-xs leading-snug text-muted">{cell.note}</p> : null}
    </div>
  );
}
