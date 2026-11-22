'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, dollarsToCents, money } from '@/lib/client';

interface Surcharge { per: 'ton' | 'bag50lb' | 'application'; amount_cents: number; from: string; until?: string | null }
const PER = { ton: 'per ton', bag50lb: 'per 50 lb bag', application: 'per salting' } as const;

/** A salt surcharge on new bills and rationing (issue 232). Neither changes an approved bill or sends anything. */
export function SaltPolicyCard({ surcharge, ration, today, owner, canEdit }: { surcharge: Surcharge | null; ration: { on: boolean; since: string | null }; today: string; owner: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ per: surcharge?.per ?? 'ton', amount: surcharge ? (surcharge.amount_cents / 100).toFixed(2) : '', from: surcharge?.from ?? today, until: surcharge?.until ?? '' });
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const ok = Number(f.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.from) && (!f.until || f.until >= f.from);
  return (
    <Card className="mb-6" data-testid="salt-policy">
      <h2 className="font-semibold">Salt this season</h2>
      <div className="mt-2 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold">Surcharge</h3>
          <p className="mt-1 text-sm text-muted">Adds a &quot;Salt surcharge&quot; line to bills, priced from the salt your drivers recorded on each visit. Only bills drafted from now on: approved and sent bills don&apos;t change, and nobody is told unless you tell them.</p>
          {surcharge ? <p className="mt-2 text-sm font-medium" data-testid="surcharge-now">On: {money(surcharge.amount_cents)} {PER[surcharge.per]} from {surcharge.from}{surcharge.until ? ` to ${surcharge.until}` : ''}.</p> : <p className="mt-2 text-sm text-muted" data-testid="surcharge-now">Off.</p>}
          {owner ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <div><Label htmlFor="sur-amt">Amount ($)</Label><Input id="sur-amt" type="number" inputMode="decimal" min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="surcharge-amount" /></div>
              <div><Label htmlFor="sur-per">Per</Label><Select id="sur-per" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value as Surcharge['per'] })} data-testid="surcharge-per"><option value="ton">ton</option><option value="bag50lb">50 lb bag</option><option value="application">salting</option></Select></div>
              <div><Label htmlFor="sur-from">From</Label><Input id="sur-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="surcharge-from" /></div>
              <div><Label htmlFor="sur-until">Until (optional)</Label><Input id="sur-until" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} data-testid="surcharge-until" /></div>
              <div className="flex gap-2 sm:col-span-4">
                <Button size="sm" disabled={!ok} data-testid="surcharge-save" onClick={() => run(() => api('/api/salt/policy', { method: 'PUT', body: { action: 'surcharge', surcharge: { per: f.per, amount_cents: dollarsToCents(f.amount), from: f.from, until: f.until || null } } }), 'Surcharge saved. It shows on bills drafted from now on.')}>Save surcharge</Button>
                {surcharge ? <Button size="sm" variant="ghost" data-testid="surcharge-off" onClick={() => run(() => api('/api/salt/policy', { method: 'PUT', body: { action: 'surcharge', surcharge: null } }), 'Surcharge off.')}>Turn off</Button> : null}
              </div>
            </div>
          ) : null}
        </section>
        <section>
          <h3 className="text-sm font-semibold">Rationing</h3>
          <p className="mt-1 text-sm text-muted">On a short allocation, drivers salt each lot&apos;s priority areas only (entrances, hills, walks and accessible spaces, set on each lot&apos;s page) and use about half their usual amount. Proof packets record that rationing was your policy. You can also turn it on for one storm from its board.</p>
          <p className="mt-2 text-sm font-medium" data-testid="ration-now">{ration.on ? `On for every storm${ration.since ? ` since ${new Date(ration.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.` : 'Off.'}</p>
          {canEdit ? <Button size="sm" className="mt-2" variant={ration.on ? 'outline' : 'accent'} data-testid="ration-toggle" onClick={() => run(() => api('/api/salt/policy', { method: 'PUT', body: { action: 'ration', on: !ration.on } }), ration.on ? 'Rationing off.' : 'Rationing on for every storm.')}>{ration.on ? 'Turn rationing off' : 'Ration salt on every storm'}</Button> : null}
        </section>
      </div>
      {msg ? <p className="mt-3 text-sm text-muted" role="status" data-testid="salt-policy-msg">{msg}</p> : null}
    </Card>
  );
}
