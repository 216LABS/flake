import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, message_log, serviceDb } from '@flake/db';
import { POST as requestRoute } from '@/app/api/c/[token]/request/route';
import { portalToken } from '@/lib/portal';
import { drain, jsonReq, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await closeDb();
});

const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe("issue 93: a customer's request note reaches the office whole", () => {
  it('a note with a # in it is not cut short', async () => {
    const w = await makeWorld();
    const token = await portalToken(w.customerIds[0]!);
    const note = 'QA #88 pass 1: please come back for the drift by the side door';
    const res = await requestRoute(jsonReq(`/api/c/${token}/request`, { site_id: w.siteIds[0]!, note }), params(token));
    expect(res.status).toBe(200);
    await drain();
    const mail = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.channel, 'email')));
    expect(mail[0]!.body).toContain(note);
    expect((mail[0]!.related as { note: string }).note).toBe(note);
  });
});

describe('issue 93: a fuller note sent after a short one is not lost', () => {
  it('a repeat with the same words just confirms, but new words reach the office', async () => {
    const w = await makeWorld();
    const token = await portalToken(w.customerIds[0]!);
    const send = (note?: string) => requestRoute(jsonReq(`/api/c/${token}/request`, { site_id: w.siteIds[0]!, ...(note ? { note } : {}) }), params(token));
    await send('QA #8');
    await send('QA #8');
    await send('QA #88 pass 1: the drift by the side door');
    await drain();
    const mail = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.channel, 'email')));
    expect(mail).toHaveLength(2);
    expect(mail.some((m) => m.body.includes('the drift by the side door'))).toBe(true);
  });
});
