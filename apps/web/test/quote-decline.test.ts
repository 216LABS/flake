import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, eq, message_log, serviceDb, sql } from '@flake/db';
import { acceptQuote, createQuote, declineQuote, getQuote } from '@/lib/quotes';
import { ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 59: a customer can decline a quote', () => {
  it('marks it declined with the reason, tells the office once, and can still be accepted later', async () => {
    const w = await makeWorld();
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    expect(await declineQuote(q.token, { reason: 'Went with my neighbor' })).toEqual({ already: false });
    expect(await declineQuote(q.token, { reason: 'twice' })).toEqual({ already: true });
    const [c] = await serviceDb().select().from(contract).where(eq(contract.id, q.contract.id));
    expect(c).toMatchObject({ status: 'declined', decline_reason: 'Went with my neighbor' });
    expect(c!.declined_at).toBeTruthy();
    expect((await getQuote(q.token)).contract.status).toBe('declined');
    await drain();
    const told = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert')));
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((m) => m.body.includes('declined'))).toBe(true);
    // Changed their mind.
    await acceptQuote(q.token, { name: 'Pat Customer', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null);
    expect((await serviceDb().select().from(contract).where(eq(contract.id, q.contract.id)))[0]!.status).toBe('accepted');
    await expect(declineQuote(q.token, {})).rejects.toMatchObject({ status: 409 });
  });
  it('the office cannot mark a quote declined itself', async () => {
    const w = await makeWorld();
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    const { withUser } = await import('@flake/db');
    const err = await withUser(w.userId, (tx) => tx.update(contract).set({ status: 'declined' }).where(eq(contract.id, q.contract.id))).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/Only the customer can decline/);
  });
});

