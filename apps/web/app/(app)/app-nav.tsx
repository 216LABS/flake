'use client';

import { cn } from '@flake/ui';
import { ClipboardList, CloudSnow, FileCheck2, LayoutDashboard, Receipt, Route, Settings, Users, Wrench } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/storms', 'Storms', CloudSnow],
  ['/customers', 'Customers', Users],
  ['/routes', 'Routes', Route],
  ['/billing', 'Billing', Receipt],
  ['/proof', 'Proof', FileCheck2],
  ['/reports', 'Reports', ClipboardList],
  ['/settings', 'Settings', Settings],
] as const;

const item = 'flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors md:flex-row md:gap-2.5 md:px-2.5 md:py-2 md:text-sm';

/** A sidebar on a desk. On a phone, every page in two rows of four, so nothing hides off the edge (issue 39). */
export function AppNav({ showDev }: { showDev: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="order-last grid w-full grid-cols-4 gap-1 whitespace-nowrap md:order-none md:flex md:flex-col">
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
