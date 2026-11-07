import { Wordmark } from '@flake/ui';
import type { ReactNode } from 'react';

/** Sign in and company setup: the night panel with the promise, beside the one thing to do. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh md:grid md:grid-cols-2">
      <section className="flex flex-col bg-slate-950 text-white">
        <div className="chevrons" />
        <div className="flex flex-1 flex-col justify-between gap-6 p-6 md:p-10">
          <Wordmark />
          <div>
            <p className="font-display text-4xl font-bold leading-none tracking-tight md:text-6xl">Plowed, proved and paid.</p>
            <p className="mt-3 hidden max-w-md text-slate-300 md:block">Know when to roll. Give drivers their route with no app. Keep proof of every visit. Bill the night of the storm.</p>
          </div>
        </div>
      </section>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
