'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@flake/ui';

const NAV = [
  ['/dashboard', 'Dashboard'],
  ['/storms', 'Storms'],
  ['/customers', 'Customers'],
  ['/routes', 'Routes'],
  ['/billing', 'Billing'],
  ['/proof', 'Proof'],
  ['/settings', 'Settings'],
] as const;

/** One line. On a phone it scrolls sideways, so the page starts near the top of the screen. */
export function AppNav({ showDev }: { showDev: boolean }) {
  const path = usePathname();
  return (
    <nav className="order-last -mx-4 flex w-screen gap-4 overflow-x-auto whitespace-nowrap px-4 text-sm text-slate-600 md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0">
      {NAV.map(([href, label]) => {
        const here = path === href || path.startsWith(`${href}/`);
        return <Link key={href} href={href} aria-current={here ? 'page' : undefined} className={cn('py-1 hover:text-slate-900', here && 'font-semibold text-slate-900 underline decoration-2 underline-offset-4')}>{label}</Link>;
      })}
      {showDev ? <Link href="/dev" className="py-1 text-amber-700 hover:text-amber-900">Dev</Link> : null}
    </nav>
  );
}
