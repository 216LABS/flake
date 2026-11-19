import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { HttpError, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/** Owner only: off to Intuit to pick the QuickBooks company. A one-time state in a cookie ties the answer to this browser. */
export const GET = route(async () => {
  await requireApi('owner');
  const { accounting } = await getProviders();
  if (!accounting.configured) throw new HttpError(503, 'QuickBooks is not set up on this server yet.', 'not_configured');
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(accounting.authorizeUrl(state, `${baseUrl()}/api/integrations/qbo/callback`));
  res.cookies.set('qbo_state', state, { httpOnly: true, secure: baseUrl().startsWith('https'), sameSite: 'lax', path: '/api/integrations/qbo', maxAge: 600 });
  return res;
});
