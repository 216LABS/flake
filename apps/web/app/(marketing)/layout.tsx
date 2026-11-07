import Link from 'next/link';
import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
          <Link href="/" className="text-lg font-bold text-slate-900">Flake <span className="font-normal text-slate-500">by 216LABS</span></Link>
          <nav className="flex flex-wrap gap-4 text-sm text-slate-700">
            <Link href="/pricing">Pricing</Link>
            <Link href="/tools/snow-removal-contract">Contract builder</Link>
            <Link href="/tools/snow-removal-pricing-calculator">Pricing calculator</Link>
          </nav>
          <Link href="/login" className="ml-auto text-sm font-medium text-sky-800">Sign in</Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 py-8 text-sm text-slate-600">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4">
          <span>© 216LABS LLC</span>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/sms-terms">SMS terms</Link>
        </div>
      </footer>
    </div>
  );
}
