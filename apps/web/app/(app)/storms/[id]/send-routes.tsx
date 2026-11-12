'use client';

import type { ReactNode } from 'react';

export interface RunReach { name: string; pass?: number; published_at?: string | null; crew: { name: string; reach?: { email: boolean; text: boolean } } | null }

/**
 * What "Send routes to crew" will do, said before it happens (issue 76): who gets their route by text or email, who
 * can't be reached and needs the QR code, and which truck has no driver yet. Only runs not sent yet are listed.
 */
export function sendRoutesBody(runs: RunReach[]): ReactNode {
  const todo = runs.filter((r) => !r.published_at);
  const how = (r: RunReach) => {
    const ways = [r.crew?.reach?.text ? 'text' : null, r.crew?.reach?.email ? 'email' : null].filter(Boolean);
    return ways.length ? `by ${ways.join(' and ')}` : null;
  };
  const label = (r: RunReach) => `${r.name}${r.pass && r.pass > 1 ? ` (pass ${r.pass})` : ''}`;
  const sent = todo.filter((r) => r.crew && how(r));
  const unreachable = todo.filter((r) => r.crew && !how(r));
  const noDriver = todo.filter((r) => !r.crew);
  return (
    <div data-testid="send-routes-list">
      {sent.length ? (
        <>
          <p className="font-medium">These drivers get their route now:</p>
          <ul className="mt-1 list-disc pl-5">{sent.map((r, i) => <li key={i}>{r.crew!.name}, {label(r)}, {how(r)}</li>)}</ul>
        </>
      ) : <p>Nobody can be messaged, so nothing is sent.</p>}
      {unreachable.length ? <p className="mt-2 text-amber-900">No text or email for {unreachable.map((r) => `${r.crew!.name} (${label(r)})`).join(', ')}. Show them the QR code instead.</p> : null}
      {noDriver.length ? <p className="mt-2 text-amber-900">{noDriver.map(label).join(', ')} {noDriver.length === 1 ? 'has' : 'have'} no driver yet. Assign one first; nothing is sent until every truck has one.</p> : null}
      <p className="mt-2 text-slate-600">To hand out links without messaging anyone, use QR / copy link on each truck instead.</p>
    </div>
  );
}
