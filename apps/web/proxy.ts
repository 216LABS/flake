import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const APP_PREFIXES = ['/dashboard', '/alerts', '/storms', '/customers', '/sites', '/routes', '/billing', '/proof', '/reports', '/settings', '/onboarding'];

/** Refreshes the Supabase session cookie, sends signed-out office visits to login, and hides /dev in production. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if ((pathname.startsWith('/dev') || pathname.startsWith('/api/dev')) && process.env.APP_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Driver, quote, webhook, cron and static paths have no session to refresh.
  matcher: ['/((?!_next/|api/d/|api/q/|api/webhooks/|api/cron/|api/health|api/tiles/|d/|q/|s/|sw.js|push-sw.js|favicon|icons/|brand/|maplibre-gl-worker|manifest).*)'],
};
