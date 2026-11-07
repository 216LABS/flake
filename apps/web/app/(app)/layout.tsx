import { Badge } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePage } from '@/lib/auth';
import { isProd, isTestEnv } from '@/lib/env';
import { ViewOnly } from './view-only';

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
            {isTestEnv() ? <Badge tone="amber" data-testid="test-badge">Test: no real charges or texts</Badge> : null}
            <span>{ctx.tenant.name}</span>
            <form action="/auth/signout" method="post"><button type="submit" className="text-slate-600 underline hover:text-slate-900" data-testid="sign-out">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {ctx.role === 'viewer' ? <p className="mb-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700" data-testid="view-only">You have view-only access. An owner can change that in Settings.</p> : null}
        {ctx.role === 'viewer' ? <ViewOnly>{children}</ViewOnly> : children}
      </main>
    </div>
  );
}
