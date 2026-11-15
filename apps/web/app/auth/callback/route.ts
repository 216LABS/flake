import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/auth';
import { NEXT_COOKIE, safeNext } from '@/lib/next-path';

/** Magic-link return. Goes to the page that asked for sign-in, or /dashboard, which sends new users to company setup. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  const jar = await cookies();
  const next = safeNext(decodeURIComponent(jar.get(NEXT_COOKIE)?.value ?? ''));
  const res = NextResponse.redirect(new URL(next, url.origin));
  res.cookies.delete(NEXT_COOKIE);
  return res;
}
