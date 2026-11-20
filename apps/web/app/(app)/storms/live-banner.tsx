import { buttonVariants, cn, Progress } from '@flake/ui';
import Link from 'next/link';
import { runningFor, type LiveStorm } from '@/lib/live';

/**
 * The storm being worked right now, pinned to the top of Storms and the Dashboard (issue 187): not one more card in a list.
 * More than one live storm gets one compact row each.
 */
export function LiveBanner({ storms }: { storms: LiveStorm[] }) {
  if (!storms.length) return null;
  const compact = storms.length > 1;
  return (
    <section aria-label={storms.length === 1 ? 'Live storm' : 'Live storms'} className="mb-6 space-y-2" data-testid="live-banner">
      {storms.map((s) => (
        <div key={s.id} className={cn('rounded-surface bg-slate-950 text-white shadow-popup', compact ? 'p-3' : 'p-4 md:p-5')} data-testid="live-storm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-beacon">
                <span className="relative flex size-2.5" aria-hidden="true"><span className="absolute inline-flex size-full animate-ping rounded-full bg-beacon opacity-75 motion-reduce:animate-none" /><span className="relative inline-flex size-2.5 rounded-full bg-beacon" /></span>
                Live storm
              </div>
              <h2 className={cn('font-display font-semibold leading-tight', compact ? 'text-lg' : 'text-2xl')}>{s.name}</h2>
              <p className="mt-0.5 text-sm text-slate-300" data-testid="live-facts">
                Running {runningFor(s.started_at)} · {s.trucks === 1 ? '1 truck out' : `${s.trucks} trucks out`}
                {s.problems ? <> · <span className="font-semibold text-amber-300">{s.problems === 1 ? '1 problem' : `${s.problems} problems`}</span></> : null}
                {s.late ? <> · <span className="font-semibold text-amber-300">{s.late} late</span></> : null}
              </p>
            </div>
            <Link href={`/storms/${s.id}`} className={cn(buttonVariants({ variant: 'accent', size: compact ? 'md' : 'lg' }), 'w-full sm:w-auto')} data-testid="open-board">Open storm board</Link>
          </div>
          <div className="mt-3">
            <Progress value={s.finished} max={s.total} label={`Stops done in ${s.name}`} className="bg-slate-700" />
            <p className="tabular mt-1 text-sm font-medium" data-testid="storm-progress">{s.total ? `${s.finished} of ${s.total} stops done` : 'No stops yet'}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
