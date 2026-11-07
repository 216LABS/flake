import { Badge } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePage } from '@/lib/auth';
import { isMock, isProd } from '@/lib/env';

const NAV = [
  ['/dashboard', 'Dashboard'],
  ['/storms', 'Storms'],
  ['/customers', 'Customers'],
  ['/routes', 'Routes'],
  ['/billing', 'Billing'],
  ['/proof', 'Proof'],
  ['/settings', 'Settings'],
] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-bold text-slate-900">Flake</Link>
          <nav className="flex flex-wrap gap-4 text-sm text-slate-600">
            {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:text-slate-900">{label}</Link>)}
            {!isProd() ? <Link href="/dev" className="text-amber-700 hover:text-amber-900">Dev</Link> : null}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            {isMock() ? <Badge tone="amber">Mock mode</Badge> : null}
            <span>{ctx.tenant.name}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
