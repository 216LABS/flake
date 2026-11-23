'use client';

import { Button, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { NEXT_COOKIE } from '@/lib/next-path';
import { browserSupabase, SsoButtons, type SsoProvider } from '@/components/sso-buttons';
import { AuthShell } from '../auth-shell';

export function LoginForm({ demo, next = '/dashboard', providers = [], initialError = null }: { demo: boolean; next?: string; providers?: SsoProvider[]; initialError?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Issue 242: a password, for someone who set one under Account and has neither Microsoft nor Google.
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const supabase = browserSupabase;
  const signInPassword = async () => {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError(/invalid login|invalid credentials/i.test(err.message) ? 'That email and password don’t match. No password set yet? Use the email code, then set one under Account.' : err.message);
    router.push(next);
    router.refresh();
  };
  const send = async () => {
    setError(null);
    setBusy(true);
    // The emailed link returns through /auth/callback, which reads this to land on the page that asked for sign-in.
    document.cookie = `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=3600; samesite=lax`;
    const { error: err } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setBusy(false);
    // Supabase's own words ("email rate limit exceeded") don't say what to do.
    // Rate limited means an email already went out, so the code box opens for the code in it.
    if (err && /rate limit|too many/i.test(err.message)) {
      setSent(true);
      setError('Too many sign-in emails were sent in the last hour. Use the code from the newest one, or try again in a few minutes.');
    } else if (err) setError(err.message);
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
    router.push(next);
    router.refresh();
  };
  return (
    <AuthShell>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in to Flake</h1>
        <p className="mt-1 text-sm text-muted">{providers.length ? 'Use your work Microsoft or Google account, or your email.' : 'We’ll email you a link. There is no password to remember.'}</p>
        {!sent && providers.length ? (
          <>
            <div className="mt-5"><SsoButtons providers={providers} next={next} onError={setError} /></div>
            <div className="mt-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />or with your email<span className="h-px flex-1 bg-line" /></div>
          </>
        ) : null}
        {withPassword && !sent ? (
          <>
            <Label className="mt-4" htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
            <Label className="mt-3" htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && void signInPassword()} data-testid="password" />
            {error ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="login-error">{error}</p> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={busy || !email.includes('@') || !password} onClick={() => void signInPassword()} data-testid="password-sign-in">Sign in</Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => { setWithPassword(false); setError(null); }} data-testid="use-email-code">Email me a link instead</Button>
          </>
        ) : sent ? (
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
            {error ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="login-error">{error}</p> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={busy || !email.includes('@')} onClick={() => void send()} data-testid="send-link">Email me a link</Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => { setWithPassword(true); setError(null); }} data-testid="use-password">Sign in with a password</Button>
          </>
        )}
        {demo ? (
          <Button variant="outline" className="mt-3 w-full" data-testid="demo-login" onClick={async () => {
            try {
              await api('/api/dev/login', { body: { email: 'demo@flake.test' } });
              router.push(next);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}>Use the demo company (local only)</Button>
        ) : null}
    </AuthShell>
  );
}
