'use client';

import { Button, Input, Label } from '@flake/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { AuthShell } from '../auth-shell';

export function OnboardingForm({ email = null, split = false }: { email?: string | null; split?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthShell>
        {split ? (
          <div className="mb-6 rounded-md bg-tint-3 p-3 text-sm" role="status" data-testid="split-account">
            <p className="font-semibold">Your company already added {email}.</p>
            <p className="mt-1">This sign-in made a separate, empty account. Sign out, sign in with the email code to {email}, then connect Microsoft or Google under Account. After that either one opens your company.</p>
            <form action="/auth/signout" method="post"><Button type="submit" variant="accent" className="mt-3 w-full" data-testid="split-sign-out">Sign out and use the email code</Button></form>
          </div>
        ) : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight">Set up your company</h1>
        <p className="mt-1 text-sm text-muted">Free for the 2026-27 season. No card needed.</p>
        <p className="mt-2 text-xs text-muted" data-testid="join-hint">Joining a company that already uses Flake? Don’t set one up: ask its owner to add you in Settings, Team.</p>
        <Label className="mt-4" htmlFor="company">Company name</Label>
        <Input id="company" value={name} onChange={(e) => setName(e.target.value)} data-testid="company" />
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="agree-terms" aria-describedby="agree-hint" />
          <span>I agree to the <Link className="text-link underline" href="/legal/terms" target="_blank">Terms of Service</Link> and the <Link className="text-link underline" href="/legal/privacy" target="_blank">Privacy Policy</Link>.</span>
        </label>
        {!agree ? <p id="agree-hint" className="mt-1 text-xs text-muted">Needed to set up your company.</p> : null}
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
        <Button variant="accent" className="mt-4 w-full" disabled={name.trim().length < 2 || !agree} data-testid="create-company" onClick={async () => {
          try {
            await api('/api/onboarding', { body: { name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, agree_terms: agree } });
            router.push('/dashboard');
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Continue</Button>
    </AuthShell>
  );
}
