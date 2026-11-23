'use client';

import { Button, cn } from '@flake/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const STEPS = [
  { title: 'Customers and lots', body: 'Who you plow for, and where.', href: '/customers' },
  { title: 'Routes', body: 'Which truck does which lots, in order.', href: '/routes' },
  { title: 'Storm', body: 'Start one when snow comes. Drivers get a link.', href: '/storms' },
  { title: 'Billing', body: 'Bills made from what drivers logged.', href: '/billing' },
] as const;

/**
 * What the page is for, for someone new (issue 188: a tester landed here and didn't know what was going on). The step
 * the company is on is highlighted. Hiding it is remembered on this device only.
 */
export function HowItWorks({ step }: { step: number }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem('flake.howItWorks') === 'hidden');
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  return (
    <section className="mb-6 rounded-surface border border-line-faint bg-surface p-4" aria-labelledby="how-title" data-testid="how-it-works">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="how-title" className="font-display text-lg font-semibold">How Flake works</h2>
          <p className="text-sm text-muted">Four steps. You&apos;re on step {step + 1}.</p>
        </div>
        <Button size="sm" variant="ghost" data-testid="how-hide" onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('flake.howItWorks', 'hidden');
          } catch {
            // Private mode: it just shows again next time.
          }
        }}>Hide</Button>
      </div>
      {/* Two by two on a phone, with only the current step's line, so it doesn't fill the first screen. */}
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Link href={s.href} aria-current={i === step ? 'step' : undefined} className={cn('block h-full rounded-control border p-2.5 transition-colors sm:p-3 hover:border-ink', i === step ? 'border-beacon bg-beacon/10' : i < step ? 'border-line-faint text-muted' : 'border-line-faint')} data-testid="how-step">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{i < step ? '✓ ' : ''}Step {i + 1}</span>
              <span className="block font-semibold text-ink">{s.title}</span>
              <span className={cn('text-sm text-muted', i === step ? 'block' : 'hidden sm:block')}>{s.body}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
