'use client';

import { Button, Card } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

export function JoinForm({ token, company, name, hasPhone, consentText }: { token: string; company: string; name: string; hasPhone: boolean; consentText: string }) {
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <h1 className="text-xl font-semibold">{name}, join {company}</h1>
        {done ? <p className="mt-3 text-sm" data-testid="joined">You&apos;re set. Your route link will come when a storm starts. There is nothing to install.</p> : (
          <>
            <p className="mt-2 text-sm text-slate-600">Route links open in your phone&apos;s browser with no app and no login. While your route page is open and a storm is active, it uses your location to prompt you when you arrive and to record your arrival. It doesn&apos;t track you in the background.</p>
            {hasPhone ? <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="crew-consent" /> {consentText}</label> : null}
            <Button variant="accent" className="mt-4 w-full" data-testid="join" onClick={async () => { await api(`/api/join/${token}`, { body: { consent } }); setDone(true); }}>Join</Button>
          </>
        )}
      </Card>
    </main>
  );
}
