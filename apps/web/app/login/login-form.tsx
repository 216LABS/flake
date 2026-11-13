'use client';

import { Button, Input, Label } from '@flake/ui';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { AuthShell } from '../auth-shell';

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const send = async () => {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };
  /**
   * The email's code signs in right here. On an iPhone with Flake on the Home Screen this is the only way that works:
   * the link opens in Safari, and Safari's sign-in isn't the Home Screen app's.
   */
  const verify = async () => {
    setError(null);
    setBusy(true);
    const token = code.replace(/\s/g, '');
    let { error: err } = await supabase().auth.verifyOtp({ email, token, type: 'email' });
    // A first sign-in's code comes from the Confirm signup email, which some Supabase versions only accept as a signup code.
    if (err && /expired|invalid/i.test(err.message)) ({ error: err } = await supabase().auth.verifyOtp({ email, token, type: 'signup' }));
    setBusy(false);
    if (err) return setError(/expired|invalid/i.test(err.message) ? 'That code is wrong or has expired. Check the newest email, or send a new one.' : err.message);
    router.push('/dashboard');
    router.refresh();
  };
  return (
    <AuthShell>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in to Flake</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll email you a link. There is no password to remember.</p>
        {sent ? (
          <>
            <p className="mt-3 text-sm" data-testid="link-sent">Check {email} for your sign-in link. Or type the code from that email here.</p>
            <Label className="mt-4" htmlFor="code">Code from the email</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length >= 6 && void verify()} data-testid="otp-code" />
            {error ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="login-error">{error}</p> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={busy || code.length < 6} onClick={() => void verify()} data-testid="otp-verify">Sign in</Button>
            <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => { setSent(false); setCode(''); setError(null); }}>Use a different email</Button>
          </>
        ) : (
          <>
            <Label className="mt-4" htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} data-testid="email" />
            {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={busy || !email.includes('@')} onClick={() => void send()} data-testid="send-link">Email me a link</Button>
          </>
        )}
        {demo ? (
          <Button variant="outline" className="mt-3 w-full" data-testid="demo-login" onClick={async () => {
            try {
              await api('/api/dev/login', { body: { email: 'demo@flake.test' } });
              router.push('/dashboard');
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}>Use the demo company (local only)</Button>
        ) : null}
    </AuthShell>
  );
}
