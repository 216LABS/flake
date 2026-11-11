import { Badge, Wordmark } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePage } from '@/lib/auth';
import { isProd, isTestEnv } from '@/lib/env';
import { AppNav, MobileTabs } from './app-nav';
import { ViewOnly } from './view-only';

/**
 * A sidebar on a desk. On a phone, one compact header row that stays at the top, and a tab bar at the bottom
 * (issue 40). The company name wraps to a second line rather than pushing Sign out off the edge.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage();
  const test = isTestEnv();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.5rem_minmax(0,1fr)]">
      <header className="sticky top-0 z-30 bg-slate-950 text-slate-300 md:h-dvh" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="chevrons" />
        <div className="flex items-center gap-3 py-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:h-[calc(100dvh-6px)] md:flex-col md:items-stretch md:gap-y-5 md:px-3 md:py-5">
          <Link href="/dashboard" className="shrink-0 md:px-2.5" aria-label="Flake dashboard"><Wordmark /></Link>
          <AppNav showDev={!isProd()} />
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm md:mt-auto md:flex-none md:flex-col md:items-start md:gap-2 md:px-2.5">
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs leading-tight text-slate-200 md:flex-none md:text-sm" data-testid="company-name">{ctx.tenant.name}</span>
            {test ? <Badge tone="amber" className="shrink-0 md:order-first" title="Test: no real charges or texts" data-testid="test-badge"><span className="md:hidden">Test</span><span className="hidden md:inline">Test: no real charges or texts</span></Badge> : null}
            <form action="/auth/signout" method="post" className="shrink-0"><button type="submit" className="min-h-11 whitespace-nowrap px-1 text-slate-300 underline-offset-2 hover:text-white hover:underline md:min-h-0 md:px-0" data-testid="sign-out">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1500px] px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8">
        {ctx.role === 'viewer' ? <p className="mb-4 rounded-md bg-slate-200 p-3 text-sm text-slate-900" data-testid="view-only">You have view-only access. An owner can change that in Settings.</p> : null}
        {ctx.role === 'viewer' ? <ViewOnly>{children}</ViewOnly> : children}
      </main>
      <MobileTabs showDev={!isProd()} />
    </div>
  );
}
