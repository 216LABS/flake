import { Badge } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePage } from '@/lib/auth';
import { isProd, isTestEnv } from '@/lib/env';
import { AppNav } from './app-nav';
import { ViewOnly } from './view-only';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:py-3">
          <Link href="/dashboard" className="font-bold text-slate-900">Flake</Link>
          <AppNav showDev={!isProd()} />
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            {isTestEnv() ? <Badge tone="amber" data-testid="test-badge">Test: no real charges or texts</Badge> : null}
            <span className="max-w-[40vw] truncate md:max-w-none">{ctx.tenant.name}</span>
            <form action="/auth/signout" method="post"><button type="submit" className="whitespace-nowrap text-slate-600 underline hover:text-slate-900" data-testid="sign-out">Sign out</button></form>
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
