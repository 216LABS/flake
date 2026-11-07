import { Badge, Wordmark } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePage } from '@/lib/auth';
import { isProd, isTestEnv } from '@/lib/env';
import { AppNav } from './app-nav';
import { ViewOnly } from './view-only';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.5rem_minmax(0,1fr)]">
      <header className="bg-slate-950 text-slate-300 md:sticky md:top-0 md:h-dvh">
        <div className="chevrons" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:h-[calc(100dvh-6px)] md:flex-col md:flex-nowrap md:items-stretch md:gap-y-5 md:py-5">
          <Link href="/dashboard" className="px-1 md:px-2.5"><Wordmark /></Link>
          <AppNav showDev={!isProd()} />
          <div className="ml-auto flex min-w-0 items-center gap-3 text-sm md:ml-0 md:mt-auto md:flex-col md:items-start md:gap-2 md:px-2.5">
            {isTestEnv() ? <Badge tone="amber" data-testid="test-badge">Test: no real charges or texts</Badge> : null}
            <span className="max-w-[40vw] truncate text-slate-200 md:max-w-full" title={ctx.tenant.name}>{ctx.tenant.name}</span>
            <form action="/auth/signout" method="post"><button type="submit" className="whitespace-nowrap text-slate-300 underline-offset-2 hover:text-white hover:underline" data-testid="sign-out">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1500px] px-4 py-5 md:px-8 md:py-8">
        {ctx.role === 'viewer' ? <p className="mb-4 rounded-md bg-slate-200 p-3 text-sm text-slate-900" data-testid="view-only">You have view-only access. An owner can change that in Settings.</p> : null}
        {ctx.role === 'viewer' ? <ViewOnly>{children}</ViewOnly> : children}
      </main>
    </div>
  );
}
