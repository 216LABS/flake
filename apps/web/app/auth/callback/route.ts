import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/auth';

/** Magic-link return. Sends new users to company setup via /dashboard. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
