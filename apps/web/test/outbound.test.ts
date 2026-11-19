import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, eq, membership, message_log, rate_limit, serviceDb, sms_consent, sql, tenant, withUser } from '@flake/db';
import { drain, makeWorld, req } from './helpers';

const ADMIN = 'boss@example.com';
const saved = process.env.ADMIN_EMAILS;

afterEach(() => {
  process.env.ADMIN_EMAILS = saved;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const row = async (id: string) => (await serviceDb().select().from(tenant).where(eq(tenant.id, id)))[0]!;
const logOf = async (tenantId: string, key: string) => (await serviceDb().select().from(message_log).where(eq(message_log.tenant_id, tenantId))).find((m) => m.idempotency_key === key);

describe('issue 171: sending is off until 216LABS turns it on, one company at a time', () => {
  it('blocks a new company, sends for the one company turned on, and leaves the other blocked', async () => {
    const { sendEmail, sendSms, notifyParty } = await import('@/lib/messaging');
    const { setOutbound } = await import('@/lib/outbound');
    process.env.ADMIN_EMAILS = ADMIN;
    const a = await makeWorld({ outboundOff: true, smsApproved: true });
    const b = await makeWorld({ outboundOff: true, smsApproved: true });
    for (const w of [a, b]) await serviceDb().insert(sms_consent).values({ tenant_id: w.tenantId, phone_e164: '+12165550188', party: 'customer', opted_in_at: new Date().toISOString(), opted_in_source: 'test' });
    expect((await row(a.tenantId)).outbound_enabled).toBe(false);

    // Off: logged as blocked, never handed to the provider, and nothing throws.
    expect(await sendEmail(await row(a.tenantId), { to: 'kim@example.com', template: 'invoice', subject: 'Bill', text: 'Your bill', key: 'bill-1' })).toBe(false);
    expect(await logOf(a.tenantId, 'email:bill-1')).toMatchObject({ status: 'blocked', provider_id: null });
    expect(await sendSms(await row(a.tenantId), { to: '+12165550188', template: 'invoice', vars: { company: 'X', storm: 'Nov 2', link: 'https://example.com/x', amount: '1.00' }, key: 'sms-1' })).toBe(false);
    expect(await logOf(a.tenantId, 'sms:sms-1')).toMatchObject({ status: 'blocked', provider_id: null });
    await expect(notifyParty(await row(a.tenantId), { phone: '+12165550188', email: 'kim@example.com' }, { template: 'quote', vars: { link: 'https://example.com/q' }, subject: 'Quote', key: 'quote-1' })).resolves.toEqual({ sms: false, email: false });

    // On for A only.
    await setOutbound(ADMIN, a.tenantId, true);
    expect(await row(a.tenantId)).toMatchObject({ outbound_enabled: true, outbound_changed_by: ADMIN });
    expect((await row(b.tenantId)).outbound_enabled).toBe(false);
    // Pressing Send again after the switch goes out.
    expect(await sendEmail(await row(a.tenantId), { to: 'kim@example.com', template: 'invoice', subject: 'Bill', text: 'Your bill', key: 'bill-1' })).toBe(true);
    expect((await logOf(a.tenantId, 'email:bill-1'))!.status).toBe('sent');
    expect(await sendSms(await row(a.tenantId), { to: '+12165550188', template: 'invoice', vars: { company: 'X', storm: 'Nov 2', link: 'https://example.com/x', amount: '1.00' }, key: 'sms-2' })).toBe(true);
    // B is still blocked.
    expect(await sendEmail(await row(b.tenantId), { to: 'kim@example.com', template: 'invoice', subject: 'Bill', text: 'Your bill', key: 'bill-1' })).toBe(false);
    expect((await logOf(b.tenantId, 'email:bill-1'))!.status).toBe('blocked');
    // Texting still needs consent even with sending on.
    expect(await sendSms(await row(a.tenantId), { to: '+12165550199', template: 'invoice', vars: { company: 'X', storm: 'Nov 2', link: 'https://example.com/x', amount: '1.00' }, key: 'sms-3' })).toBe(false);

    // Feedback to 216LABS itself is not a company send.
    expect(await sendEmail(await row(b.tenantId), { to: ADMIN, template: 'feedback', subject: 'Feedback', text: 'Hi', key: 'fb-1', internal: true })).toBe(true);
  });

  it('only an admin can turn it on or off: not the owner, not through settings, not through the database', async () => {
    const { setOutbound } = await import('@/lib/outbound');
    process.env.ADMIN_EMAILS = ADMIN;
    const w = await makeWorld({ outboundOff: true });
    await expect(setOutbound('owner@flake.test', w.tenantId, true)).rejects.toMatchObject({ status: 403 });
    await expect(withUser(w.userId, (tx) => tx.update(tenant).set({ outbound_enabled: true }).where(eq(tenant.id, w.tenantId)))).rejects.toThrow();

    const auth = await import('@/lib/auth');
    vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner', email: 'owner@flake.test', tenant: await row(w.tenantId) } as never);
    const { PATCH } = await import('@/app/api/admin/outbound/route');
    expect((await PATCH(req('/api/admin/outbound', { method: 'PATCH', body: JSON.stringify({ tenant_id: w.tenantId, enabled: true }) }), {} as never)).status).toBe(404);
    const settings = await import('@/app/api/settings/route');
    await settings.PATCH(req('/api/settings', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed Plow', outbound_enabled: true }) }), {} as never);
    expect(await row(w.tenantId)).toMatchObject({ name: 'Renamed Plow', outbound_enabled: false });

    // The admin's write names one company.
    const other = await makeWorld({ outboundOff: true });
    vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner', email: ADMIN, tenant: await row(w.tenantId) } as never);
    expect((await PATCH(req('/api/admin/outbound', { method: 'PATCH', body: JSON.stringify({ tenant_id: other.tenantId, enabled: true }) }), {} as never)).status).toBe(200);
    expect((await row(other.tenantId)).outbound_enabled).toBe(true);
    expect((await row(w.tenantId)).outbound_enabled).toBe(false);
  });
});

describe('issue 172: Terms and Privacy at signup', () => {
  const newUser = async () => {
    const id = randomUUID();
    await serviceDb().execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${`t172-${id}@example.com`}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
    return id;
  };

  it('refuses a company without the agreement, and stores who agreed, when and to which versions', async () => {
    const auth = await import('@/lib/auth');
    const { POST } = await import('@/app/api/onboarding/route');
    const { TERMS_VERSION } = await import('@/lib/legal');
    const u = await newUser();
    vi.spyOn(auth, 'currentUser').mockResolvedValue({ id: u, email: `t172-${u}@example.com` });
    const no = await POST(req('/api/onboarding', { method: 'POST', body: JSON.stringify({ name: 'No Agree Plow', timezone: 'America/New_York' }) }), {} as never);
    expect(no.status).toBe(422);
    expect((await no.json()).error).toContain('Terms of Service');
    expect(await serviceDb().select().from(membership).where(eq(membership.user_id, u))).toEqual([]);
    expect((await POST(req('/api/onboarding', { method: 'POST', body: JSON.stringify({ name: 'No Agree Plow', agree_terms: false }) }), {} as never)).status).toBe(422);

    const before = Date.now();
    const yes = await POST(req('/api/onboarding', { method: 'POST', body: JSON.stringify({ name: 'Agree Plow', timezone: 'America/New_York', agree_terms: true }) }), {} as never);
    expect(yes.status).toBe(201);
    const t = await row((await yes.json()).tenant_id);
    expect(t).toMatchObject({ terms_accepted_by: u, terms_version: TERMS_VERSION, outbound_enabled: false });
    const at = Date.parse(t.terms_accepted_at!);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now());
    // The owner can't clear it.
    await expect(withUser(u, (tx) => tx.update(tenant).set({ terms_accepted_at: null }).where(eq(tenant.id, t.id)))).rejects.toThrow();
  });
});

describe('issue 173: logo', () => {
  it('takes a PNG, refuses anything else, serves it on customer pages and nowhere else in storage', async () => {
    const { saveLogo, logoUrl, removeLogo } = await import('@/lib/logo');
    const w = await makeWorld();
    // A 1x1 PNG.
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    await expect(saveLogo(w.tenantId, new TextEncoder().encode('<svg onload=alert(1)>'))).rejects.toMatchObject({ status: 422 });
    await expect(saveLogo(w.tenantId, new Uint8Array(1_000_001).fill(0x89))).rejects.toMatchObject({ status: 413 });
    await saveLogo(w.tenantId, png);
    const t = await row(w.tenantId);
    expect(t.logo_path).toMatch(new RegExp(`^${w.tenantId}/logo/.+\\.png$`));
    const url = logoUrl(t)!;
    const { GET } = await import('@/app/api/logo/[tenantId]/route');
    const res = await GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ tenantId: w.tenantId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    // An owner can't point the logo at another file.
    await expect(withUser(w.userId, (tx) => tx.update(tenant).set({ logo_path: 'other/coi/x.pdf' }).where(eq(tenant.id, w.tenantId)))).rejects.toThrow();
    await removeLogo(w.tenantId);
    expect((await row(w.tenantId)).logo_path).toBeNull();
    expect((await GET(new Request('http://localhost/x'), { params: Promise.resolve({ tenantId: w.tenantId }) })).status).toBe(404);
  });
});

describe('issue 176: rate limits shared by every server instance', () => {
  it('counts in the database, so another instance that already used the limit makes this one refuse', async () => {
    const { rateLimit } = await import('@/lib/http');
    const key = `t176:203.0.113.${Math.floor(Math.random() * 200)}:${randomUUID().slice(0, 6)}`;
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    // Another instance already counted 3 for this address in this window.
    await serviceDb().insert(rate_limit).values({ key, window_start: start, n: 3 });
    await expect(rateLimit(key, 3, 60_000)).rejects.toMatchObject({ status: 429 });
    // A fresh key is fine up to its limit, then refused.
    const fresh = `${key}:b`;
    await rateLimit(fresh, 2, 60_000);
    await rateLimit(fresh, 2, 60_000);
    await expect(rateLimit(fresh, 2, 60_000)).rejects.toMatchObject({ status: 429 });
    // No address: this instance's own count only, no shared row.
    await rateLimit('t176:null', 2, 60_000);
    expect(await serviceDb().select().from(rate_limit).where(eq(rate_limit.key, 't176:null'))).toEqual([]);
  });
});
