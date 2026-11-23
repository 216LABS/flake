'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useState } from 'react';
import { NEXT_COOKIE } from '@/lib/next-path';

export type SsoProvider = 'azure' | 'google';
const NAME: Record<SsoProvider, string> = { azure: 'Microsoft', google: 'Google' };

export const browserSupabase = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

/** The providers' own marks, as their brand guides ask: Microsoft's four squares and Google's colored G. */
export function ProviderLogo({ provider }: { provider: SsoProvider }) {
  if (provider === 'azure') {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 21 21">
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const btn = 'flex min-h-11 w-full items-center justify-center gap-2.5 rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-tint disabled:opacity-60';

/**
 * "Continue with Microsoft" and "Continue with Google" (issue 242). Sign in sends the person to the provider and back
 * through /auth/callback; connect adds the provider to the account that's signed in now.
 */
export function SsoButtons({ providers, next, mode = 'sign-in', onError }: { providers: SsoProvider[]; next: string; mode?: 'sign-in' | 'connect'; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<SsoProvider | null>(null);
  if (!providers.length) return null;
  const go = async (provider: SsoProvider) => {
    setBusy(provider);
    // The provider returns through /auth/callback, which reads this to land back on the page that asked.
    document.cookie = `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;
    const options = {
      redirectTo: `${location.origin}/auth/callback`,
      // Microsoft leaves the email out unless asked; both show their account chooser, which matters on a shared office PC.
      scopes: provider === 'azure' ? 'openid profile email' : undefined,
      queryParams: { prompt: 'select_account' },
    };
    const auth = browserSupabase().auth;
    const { error } = mode === 'connect' ? await auth.linkIdentity({ provider, options }) : await auth.signInWithOAuth({ provider, options });
    if (error) {
      setBusy(null);
      onError(/manual linking/i.test(error.message) ? 'Connecting accounts is turned off for this site. Ask Flake support.' : `${NAME[provider]} sign-in didn’t start: ${error.message}`);
    }
  };
  return (
    <div className="space-y-2" data-testid={mode === 'connect' ? 'sso-connect' : 'sso-buttons'}>
      {providers.map((p) => (
        <button key={p} type="button" className={btn} disabled={busy !== null} onClick={() => void go(p)} data-testid={`${mode === 'connect' ? 'connect' : 'sso'}-${p}`}>
          <ProviderLogo provider={p} />
          {busy === p ? `Opening ${NAME[p]}…` : mode === 'connect' ? `Connect ${NAME[p]}` : `Continue with ${NAME[p]}`}
        </button>
      ))}
    </div>
  );
}
