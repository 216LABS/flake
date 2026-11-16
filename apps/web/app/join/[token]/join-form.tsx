'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

/**
 * A driver joins the crew: their mobile, and whether they agree to route links by text (D16: drivers get texts, never
 * email). Saying no still joins; the office then shows them the route's QR code.
 */
export function JoinForm({ token, company, name, hasPhone, consentText, canText, joined = false, expired = false }: { expired?: boolean; token: string; company: string; name: string; hasPhone: boolean; consentText: string; email?: string; canText: boolean; joined?: boolean }) {
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useState('');
  const digits = phone.replace(/\D/g, '');
  const phoneOk = !phone.trim() || digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  // A number is needed only to text them; saying no to texts joins without one.
  const needPhone = consent && !hasPhone && !phone.trim();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <h1 className="text-xl font-semibold">{name}, join {company}</h1>
        {expired ? (
          <div className="mt-4 rounded-md bg-warn-tint p-4 text-warn-ink" role="status" data-testid="invite-expired">
            <p className="font-semibold">This invite has expired.</p>
            <p className="mt-1 text-sm">Join links work for two weeks. Ask {company} to send you a new one.</p>
          </div>
        ) : joined ? (
          <div className="mt-4 rounded-md bg-tint p-4" role="status" data-testid="already-joined">
            <p className="font-semibold">You&apos;re already on the crew.</p>
            <p className="mt-1 text-sm text-ink-2">Your route link comes when a storm starts. To change your number, ask {company} for a new join link.</p>
          </div>
        ) : done ? (
          <div className="mt-4 rounded-md bg-ok-tint p-4 text-ok-ink" role="status" data-testid="joined">
            <p className="text-lg font-semibold">✓ You&apos;re on the crew</p>
            <p className="mt-1 text-sm">{consent ? `Your route link comes by text when a storm starts${canText ? '' : `, once ${company} has texting set up. Until then they show you a QR code to scan`}.` : `${company} will show you a QR code for your route when a storm starts.`} There is nothing to install, and you can close this page.</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">Route links open in your phone&apos;s browser with no app and no login. While your route page is open and a storm is active, it uses your location to prompt you when you arrive and to record your arrival. It doesn&apos;t track you in the background.</p>
            <div className="mt-4">
              <Label htmlFor="join-phone">Your mobile number</Label>
              <Input id="join-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(216) 555-0101" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="join-phone" aria-describedby="join-phone-hint" />
              <p id="join-phone-hint" className="mt-1 text-xs text-muted">{hasPhone ? `${company} already has a number for you. Enter yours here only if it's different.` : 'Your route links come to this number by text.'}</p>
              {!phoneOk ? <p className="mt-1 text-xs text-danger">Enter a 10-digit US mobile number.</p> : null}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="crew-consent" /> {consentText}</label>
            <Button variant="accent" className="mt-4 w-full" disabled={needPhone || !phoneOk} data-testid="join" onClick={async () => { setError(null); try { await api(`/api/join/${token}`, { body: { consent, phone: phone.trim() ? `+1${digits.slice(-10)}` : '' } }); setDone(true); } catch (e) { setError((e as Error).message); } }}>Join</Button>
            {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
          </>
        )}
      </Card>
    </main>
  );
}
