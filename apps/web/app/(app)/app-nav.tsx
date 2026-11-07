'use client';

import { cn } from '@flake/ui';
import { CloudSnow, FileCheck2, LayoutDashboard, Receipt, Route, Settings, Users, Wrench } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/storms', 'Storms', CloudSnow],
  ['/customers', 'Customers', Users],
  ['/routes', 'Routes', Route],
  ['/billing', 'Billing', Receipt],
  ['/proof', 'Proof', FileCheck2],
  ['/settings', 'Settings', Settings],
] as const;

const item = 'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors';

/** A sidebar on a desk, and one line that scrolls sideways on a phone. */
export function AppNav({ showDev }: { showDev: boolean }) {
  const path = usePathname();
  return (
    <nav className="order-last flex w-full gap-1 overflow-x-auto whitespace-nowrap md:order-none md:flex-col md:overflow-visible">
      {NAV.map(([href, label, Icon]) => {
        const here = path === href || path.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={here ? 'page' : undefined} className={cn(item, here ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-900 hover:text-white')}>
            <Icon size={17} aria-hidden="true" className={here ? 'text-beacon' : undefined} />
            {label}
          </Link>
        );
      })}
      {showDev ? <Link href="/dev" className={cn(item, 'text-amber-300 hover:bg-slate-900')}><Wrench size={17} aria-hidden="true" />Dev</Link> : null}
    </nav>
  );
}
