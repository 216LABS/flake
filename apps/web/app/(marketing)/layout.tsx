import { Wordmark } from '@flake/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="bg-slate-950 text-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-baseline gap-2"><Wordmark /><span className="text-sm text-slate-300">by 216LABS</span></Link>
          <nav className="order-last flex w-full gap-5 overflow-x-auto whitespace-nowrap text-sm md:order-none md:w-auto">
            <Link className="hover:text-white" href="/pricing">Pricing</Link>
            <Link className="hover:text-white" href="/tools/snow-removal-contract">Contract builder</Link>
            <Link className="hover:text-white" href="/tools/snow-removal-pricing-calculator">Pricing calculator</Link>
          </nav>
          <Link href="/login" className="ml-auto text-sm font-semibold text-white underline-offset-2 hover:underline">Sign in</Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-slate-950 text-sm text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6">
          <span>© 216LABS LLC</span>
          <Link className="hover:text-white" href="/legal/terms">Terms</Link>
          <Link className="hover:text-white" href="/legal/privacy">Privacy</Link>
          <Link className="hover:text-white" href="/legal/sms-terms">SMS terms</Link>
        </div>
      </footer>
    </div>
  );
}
