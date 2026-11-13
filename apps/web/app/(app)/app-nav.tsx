'use client';

import { cn } from '@flake/ui';
import { ClipboardList, CloudSnow, FileCheck2, LayoutDashboard, Menu, Receipt, Route, Settings, Users, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useModal } from '@/components/use-modal';

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

/** On a phone, the four places a storm night lives get a tab. The rest are one tap away under More. */
const TABS = ['/dashboard', '/storms', '/customers', '/billing'];

const isHere = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** The sidebar on a desk. Phones get the bottom tab bar below instead (issue 40). */
export function AppNav({ showDev }: { showDev: boolean }) {
  const path = usePathname();
  const item = 'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors';
  return (
    <nav aria-label="Main" className="hidden flex-col gap-1 whitespace-nowrap md:flex">
      {NAV.map(([href, label, Icon]) => {
        const here = isHere(path, href);
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

/**
 * A thumb-reach tab bar fixed to the bottom of a phone, clear of the home indicator. It stays put on a long storm
 * board or customer list, where a nav at the top would have scrolled away.
 */
export function MobileTabs({ showDev }: { showDev: boolean }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const menu = useRef<HTMLElement>(null);
  useModal(menu, { active: more });
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);
  const rest = NAV.filter(([href]) => !TABS.includes(href));
  const inMore = rest.some(([href]) => isHere(path, href)) || (showDev && isHere(path, '/dev'));
  const tab = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium';
  return (
    <div className="md:hidden">
      {more ? <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-slate-950/40" onClick={() => setMore(false)} /> : null}
      {more ? (
        <nav ref={menu} aria-label="More" id="more-menu" data-testid="more-menu" className="fixed inset-x-0 z-50 rounded-t-popup bg-slate-950 p-3 text-slate-200 shadow-popup" style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}>
          <ul className="grid grid-cols-2 gap-2">
            {[...rest, ...(showDev ? ([['/dev', 'Dev', Wrench]] as const) : [])].map(([href, label, Icon]) => {
              const here = isHere(path, href);
              return (
                <li key={href}>
                  <Link href={href} aria-current={here ? 'page' : undefined} className={cn('flex min-h-12 items-center gap-3 rounded-md px-3 text-base font-medium', here ? 'bg-slate-800 text-white' : 'hover:bg-slate-900')}>
                    <Icon size={20} aria-hidden="true" className={here ? 'text-beacon' : undefined} />{label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      <nav aria-label="Main" data-testid="tab-bar" className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-800 bg-slate-950 text-slate-300" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV.filter(([href]) => TABS.includes(href)).map(([href, label, Icon]) => {
          const here = isHere(path, href) && !more;
          return (
            <Link key={href} href={href} aria-current={here ? 'page' : undefined} className={cn(tab, here ? 'text-white' : 'hover:text-white')}>
              <Icon size={22} aria-hidden="true" className={here ? 'text-beacon' : undefined} />{label}
            </Link>
          );
        })}
        <button type="button" data-testid="more-tab" aria-expanded={more} aria-controls="more-menu" className={cn(tab, (inMore || more) ? 'text-white' : 'hover:text-white')} onClick={() => setMore(!more)}>
          {more ? <X size={22} aria-hidden="true" className="text-beacon" /> : <Menu size={22} aria-hidden="true" className={inMore ? 'text-beacon' : undefined} />}More
        </button>
      </nav>
    </div>
  );
}
