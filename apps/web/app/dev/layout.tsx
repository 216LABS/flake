import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isProd } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (isProd()) notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-6 flex gap-4 border-b pb-3 text-sm">
        <Link href="/dashboard" className="font-bold">Flake</Link>
        <Link className="underline" href="/dev">Dev home</Link>
        <Link className="underline" href="/dev/inbox">Inbox</Link>
        <Link className="underline" href="/dev/weather">Weather clock</Link>
      </nav>
      {children}
    </div>
  );
}
