'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import type { UserIdentity } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { browserSupabase, ProviderLogo, SsoButtons, type SsoProvider } from '@/components/sso-buttons';

const NAME: Record<string, string> = { azure: 'Microsoft', google: 'Google', email: 'Email code' };

/**
 * Connecting Microsoft or Google here links it to this same Flake account, so either one signs in to the same company
 * and role. That's how someone the office added by email starts using their work account (issue 242).
 */
export function AccountPanel({ email, providers, initialError }: { email: string | null; providers: SsoProvider[]; initialError: string | null }) {
  const [ids, setIds] = useState<UserIdentity[] | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [note, setNote] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error: err } = await browserSupabase().auth.getUserIdentities();
    if (err) setError(err.message);
    setIds(data?.identities ?? []);
  };
  useEffect(() => { void load(); }, []);
  const linked = new Set((ids ?? []).map((i) => i.provider));
  const unlink = async (identity: UserIdentity) => {
    setError(null);
    setNote(null);
    setBusy(true);
    const { error: err } = await browserSupabase().auth.unlinkIdentity(identity);
    setBusy(false);
    if (err) return setError(/manual linking/i.test(err.message) ? 'Disconnecting accounts is turned off for this site. Ask Flake support.' : err.message);
    setNote(`${NAME[identity.provider] ?? identity.provider} disconnected.`);
    await load();
  };
  const savePassword = async () => {
    setError(null);
    setNote(null);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords don’t match.');
    setBusy(true);
    const { error: err } = await browserSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(/different from the old/i.test(err.message) ? 'That’s already your password.' : err.message);
    setPw('');
    setPw2('');
    setNote('Password saved. You can sign in with your email and this password.');
  };
  return (
    <div className="max-w-xl space-y-4">
      {error ? <p className="rounded-md bg-danger-tint p-3 text-sm text-danger" role="alert" data-testid="account-error">{error}</p> : null}
      {note ? <p className="rounded-md bg-tint-2 p-3 text-sm" role="status" data-testid="account-note">{note}</p> : null}
      <Card className="p-4">
        <h2 className="font-display text-lg font-semibold">Ways to sign in</h2>
        <p className="mt-1 text-sm text-muted">Signed in as <span className="font-medium text-ink" data-testid="account-email">{email}</span>. A code to this email always works.</p>
        <ul className="mt-3 divide-y divide-line-faint" data-testid="identities">
          {ids === null ? <li className="py-2 text-sm text-muted">Loading…</li> : ids.map((i) => (
            <li key={i.identity_id} className="flex items-center gap-3 py-2.5" data-testid={`identity-${i.provider}`}>
              {i.provider === 'azure' || i.provider === 'google' ? <ProviderLogo provider={i.provider} /> : <span aria-hidden="true" className="w-[18px] text-center">@</span>}
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{NAME[i.provider] ?? i.provider}</span>
                {i.identity_data?.email ? <span className="block truncate text-muted">{String(i.identity_data.email)}</span> : null}
              </span>
              {i.provider !== 'email' && ids.length > 1 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void unlink(i)} data-testid={`disconnect-${i.provider}`}>Disconnect</Button> : null}
            </li>
          ))}
        </ul>
        {ids !== null && providers.some((p) => !linked.has(p)) ? (
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted">Connect your work account, even if its email is different from this one. After that it signs you in here.</p>
            <SsoButtons providers={providers.filter((p) => !linked.has(p))} next="/account" mode="connect" onError={setError} />
          </div>
        ) : null}
      </Card>
      <Card className="p-4">
        <h2 className="font-display text-lg font-semibold">Password</h2>
        <p className="mt-1 text-sm text-muted">For when you have no Microsoft or Google account and would rather not wait for an email. Set one, or change it.</p>
        <Label className="mt-3" htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="new-password" />
        <Label className="mt-3" htmlFor="new-password-2">Type it again</Label>
        <Input id="new-password-2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void savePassword()} data-testid="new-password-2" />
        <Button variant="accent" className="mt-3" disabled={busy || !pw || !pw2} onClick={() => void savePassword()} data-testid="save-password">Save password</Button>
      </Card>
    </div>
  );
}
