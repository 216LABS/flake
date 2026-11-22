import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isProd } from './lib/env';
import { safeNext } from './lib/next-path';

const APP_PREFIXES = ['/admin', '/dashboard', '/alerts', '/storms', '/customers', '/sites', '/routes', '/billing', '/proof', '/reports', '/settings', '/onboarding', '/help'];

/** Refreshes the Supabase session cookie, sends signed-out office visits to login, and hides /dev in production. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isProd() && pathname.startsWith('/api/dev/')) return new NextResponse('Not found', { status: 404 });
  // A page gets the app's own 404, which fits a phone, instead of a bare desktop-width "Not found" (issue 124).
  if (isProd() && (pathname === '/dev' || pathname.startsWith('/dev/'))) return NextResponse.rewrite(new URL('/not-found-hidden', request.url));
  // The path and method, for the role checks in lib/auth (issue 227). Always set here, so a client can't send its own.
  const forward = () => {
    const h = new Headers(request.headers);
    h.set('x-flake-path', pathname);
    h.set('x-flake-method', request.method);
    return NextResponse.next({ request: { headers: h } });
  };
  let response = forward();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = forward();
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    // Back to this page after signing in, e.g. from an alert email opened on a signed-out phone (issue 142).
    const next = safeNext(`${pathname}${request.nextUrl.search}`);
    url.pathname = '/login';
    url.search = next === '/dashboard' ? '' : `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Driver, quote, webhook, cron and static paths have no session to refresh.
  matcher: ['/((?!_next/|api/d/|api/q/|api/webhooks/|api/cron/|api/health|api/supplier/|supplier/|api/tiles/|d/|q/|s/|sw.js|push-sw.js|favicon|apple-touch-icon|icons/|brand/|maplibre-gl-worker|manifest).*)'],
};
