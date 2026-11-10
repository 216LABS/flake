'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

export function JoinForm({ token, company, name, hasPhone, consentText, email: knownEmail, canText }: { token: string; company: string; name: string; hasPhone: boolean; consentText: string; email: string; canText: boolean }) {
  const [consent, setConsent] = useState(false);
  const [email, setEmail] = useState(knownEmail);
  // Until the company's texting is approved, email is the only way a route link reaches the driver.
  const needEmail = !canText && !email.trim();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <h1 className="text-xl font-semibold">{name}, join {company}</h1>
        {done ? (
          <div className="mt-4 rounded-md bg-emerald-50 p-4 text-emerald-950" role="status" data-testid="joined">
            <p className="text-lg font-semibold">✓ You&apos;re on the crew</p>
            <p className="mt-1 text-sm">Your route link comes {email.trim() ? `to ${email.trim()}` : 'by text'} when a storm starts. There is nothing to install, and you can close this page.</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">Route links open in your phone&apos;s browser with no app and no login. While your route page is open and a storm is active, it uses your location to prompt you when you arrive and to record your arrival. It doesn&apos;t track you in the background.</p>
            <div className="mt-4">
              <Label htmlFor="join-email">Email for your route links</Label>
              <Input id="join-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="join-email" aria-describedby="join-email-hint" />
              <p id="join-email-hint" className="mt-1 text-xs text-slate-600">{canText ? 'Optional. Links also come by text if you allow it below.' : `${company} can't send texts yet, so your route link comes by email.`}</p>
            </div>
            {hasPhone ? <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="crew-consent" /> {consentText}</label> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={needEmail} data-testid="join" onClick={async () => { setError(null); try { await api(`/api/join/${token}`, { body: { consent, email: email.trim() } }); setDone(true); } catch (e) { setError((e as Error).message); } }}>Join</Button>
            {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
          </>
        )}
      </Card>
    </main>
  );
}
