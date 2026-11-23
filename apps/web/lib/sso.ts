import { sql as dsql, serviceDb } from '@flake/db';
import { isLocalOrTest } from './env';

/**
 * Microsoft and Google sign-in (issue 242). Supabase does the OAuth work: Authorization Code with PKCE, the state and
 * nonce checks, and the ID token's issuer, audience, signature and expiry. Flake never sees a provider token or
 * secret; the secrets live in the Supabase dashboard. See docs/SSO_SETUP.md.
 */
export type SsoProvider = 'azure' | 'google';
export const SSO_PROVIDERS: readonly SsoProvider[] = ['azure', 'google'];
export const SSO_NAME: Record<SsoProvider, string> = { azure: 'Microsoft', google: 'Google' };

/** Which providers the Supabase project has turned on, read from its public settings. */
export function parseEnabled(settings: unknown): SsoProvider[] {
  const ext = (settings as { external?: Record<string, unknown> } | null)?.external ?? {};
  return SSO_PROVIDERS.filter((p) => ext[p] === true);
}

/**
 * The buttons show only for providers that are on, so the login page never offers a button that fails. A laptop or the
 * test run can name them in SSO_PROVIDERS instead, because the local Supabase has no provider apps.
 */
export async function enabledSso(): Promise<SsoProvider[]> {
  const forced = process.env.SSO_PROVIDERS;
  if (forced !== undefined && isLocalOrTest()) return SSO_PROVIDERS.filter((p) => forced.split(',').map((s) => s.trim()).includes(p));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    return res.ok ? parseEnabled(await res.json()) : [];
  } catch {
    // Supabase slow or down: email sign-in still shows.
    return [];
  }
}

/** What a failed sign-in (a provider, or an emailed link) says. The provider's own text can be long or technical, so it's mapped. */
export function ssoErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === 'access_denied') return 'Sign-in was cancelled. Try again, or use your email.';
  if (code === 'link_taken') return 'That Microsoft or Google account is already connected to a different Flake sign-in.';
  if (code === 'link_off') return 'Connecting accounts is turned off for this site. Ask Flake support.';
  if (code === 'expired') return 'That sign-in was started in a different browser, or took too long. Start again here, or type the code from the email.';
  return 'That sign-in didn’t work. Try again, or sign in with your email.';
}

/** The callback's error, from the provider's error and Supabase's description, as one of the codes above. */
export function ssoErrorCode(error: string | null, description: string | null): string {
  const d = (description ?? '').toLowerCase();
  if (error === 'access_denied' && !d.includes('manual linking')) return 'access_denied';
  if (d.includes('already linked') || d.includes('identity_already_exists') || d.includes('already exists')) return 'link_taken';
  if (d.includes('manual linking')) return 'link_off';
  if (d.includes('code verifier') || d.includes('flow state') || d.includes('expired')) return 'expired';
  return 'failed';
}

/**
 * Someone whose company added them by email, who then signed in with a Microsoft account whose email Microsoft hadn't
 * verified, gets a second, empty Flake account. Onboarding uses this to tell them instead of offering a new company.
 */
export async function teamAccountForEmail(userId: string, email: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await serviceDb().execute(dsql`select 1 from auth.users u join public.membership m on m.user_id = u.id where lower(u.email) = lower(${email}) and u.id <> ${userId}::uuid limit 1`);
  return (rows as unknown as unknown[]).length > 0;
}
