import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/auth';
import { log } from '@/lib/log';
import { NEXT_COOKIE, safeNext } from '@/lib/next-path';
import { ssoErrorCode } from '@/lib/sso';

/**
 * The return from an emailed link, Microsoft or Google sign-in, or connecting one of them (issue 242). Goes to the page
 * that asked, or /dashboard, which sends new users to company setup. A failure goes back to that page (Account, when
 * connecting) or to sign in, with a short code the page turns into words. No token or code is logged.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  let failed: string | null = null;
  if (url.searchParams.get('error')) failed = ssoErrorCode(url.searchParams.get('error'), url.searchParams.get('error_description'));
  else if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failed = ssoErrorCode(null, error.message);
  }
  const jar = await cookies();
  const next = safeNext(decodeURIComponent(jar.get(NEXT_COOKIE)?.value ?? ''));
  let to = next;
  if (failed) {
    log.info('auth_callback_failed', { reason: failed });
    to = next.startsWith('/account') ? `/account?error=${failed}` : `/login?error=${failed}${next === '/dashboard' ? '' : `&next=${encodeURIComponent(next)}`}`;
  }
  const res = NextResponse.redirect(new URL(to, url.origin));
  res.cookies.delete(NEXT_COOKIE);
  return res;
}
