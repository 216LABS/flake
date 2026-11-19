import { timingSafeEqual } from 'node:crypto';
import { integration, serviceDb } from '@flake/db';
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { route } from '@/lib/http';
import { log } from '@/lib/log';
import { getProviders } from '@/lib/providers';
import { encryptToken } from '@/lib/tokens';

const back = (q: string) => {
  const res = NextResponse.redirect(`${baseUrl()}/settings?tab=accounting&qbo=${q}`);
  res.cookies.delete({ name: 'qbo_state', path: '/api/integrations/qbo' });
  return res;
};

/** Intuit sends the owner back here with a code. The state must match this browser's cookie. Tokens are stored encrypted. */
export const GET = route(async (req) => {
  const ctx = await requireApi('owner');
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const cookie = req.headers.get('cookie')?.match(/(?:^|;\s*)qbo_state=([^;]+)/)?.[1] ?? '';
  const same = state.length > 0 && state.length === cookie.length && timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
  if (!same) return back('expired');
  if (url.searchParams.get('error') || !code || !realmId) return back('cancelled');
  const { accounting } = await getProviders();
  try {
    const t = await accounting.exchange(code, realmId, `${baseUrl()}/api/integrations/qbo/callback`);
    const values = { realm_id: realmId, token_enc: encryptToken(t.access), refresh_enc: encryptToken(t.refresh), expires_at: t.expiresAt, status: 'connected' as const, status_detail: null, connected_by: ctx.userId, updated_at: new Date().toISOString() };
    await serviceDb().insert(integration).values({ tenant_id: ctx.tenantId, provider: 'qbo', ...values }).onConflictDoUpdate({ target: [integration.tenant_id, integration.provider], set: values });
    return back('connected');
  } catch (err) {
    log.error('quickbooks connect failed', err, { tenantId: ctx.tenantId });
    return back('failed');
  }
});
