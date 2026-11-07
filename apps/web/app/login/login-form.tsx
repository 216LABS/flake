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
  const send = async () => {
    setError(null);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: err } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    if (err) setError(err.message);
    else setSent(true);
  };
  return (
    <AuthShell>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in to Flake</h1>
        <p className="mt-1 text-sm text-slate-600">We&apos;ll email you a link. There is no password to remember.</p>
        {sent ? <p className="mt-3 text-sm" data-testid="link-sent">Check {email} for your sign-in link.</p> : (
          <>
            <Label className="mt-4" htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} data-testid="email" />
            {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
            <Button variant="accent" className="mt-4 w-full" disabled={!email.includes('@')} onClick={() => void send()} data-testid="send-link">Email me a link</Button>
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
