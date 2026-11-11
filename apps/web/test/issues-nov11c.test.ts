import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, message_log, run_stop, serviceDb, sql, visit } from '@flake/db';
import { processActions, resolveToken } from '@/lib/driver';
import { plainText } from '@/lib/messaging';
import { createQuote, declineQuote } from '@/lib/quotes';
import { closeStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 70: what someone typed reaches the office as plain text', () => {
  it('strips tags and control characters and caps the length', () => {
    expect(plainText('Nope <script>alert(1)</script><img src=x onerror=alert(2)> thanks')).toBe('Nope alert(1) thanks');
    expect(plainText('a\u0000b\nc')).toBe('a b c');
    expect(plainText('x'.repeat(400), 50)).toHaveLength(50);
  });
  it('a decline note with HTML gives the office a short subject and a clean body', async () => {
    const w = await makeWorld();
    const q = await createQuote(ctxOf(w), { site_id: w.siteIds[0]!, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    await declineQuote(q.token, { reason: 'No thanks <script>alert(1)</script><img src=x onerror=alert(2)>' });
    await drain();
    const [m] = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'owner_alert'), eq(message_log.channel, 'email')));
    expect(m!.status).toBe('sent');
    expect(m!.body).toContain('Their note: "No thanks alert(1)"');
    expect(m!.body).not.toMatch(/<|onerror/);
    // The stored note stays exactly as typed; the site page escapes it.
    const [c] = (await serviceDb().execute(sql`select decline_reason from contract where id = ${q.contract.id}`)) as unknown as { decline_reason: string }[];
    expect(c!.decline_reason).toContain('<script>');
  });
});

describe('issue 71: a lot started before the close can still be finished after it', () => {
  it('Arrive again resumes the visit, and Done lands, while new lots stay refused', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    const started = stopActions(stops[0]!.id, new Date(Date.now() - 20 * 60_000));
    await processActions(rs, [started.actions[0]] as never);
    // The driver moved on with a Problem and did the next lot.
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date(Date.now() - 15 * 60_000).toISOString(), kind: 'problem', run_stop_id: stops[0]!.id, problem: 'blocked', note: null }]);
    await processActions(rs, stopActions(stops[1]!.id, new Date(Date.now() - 10 * 60_000)).actions as never);
    await closeStorm(ctx, out.storm.id, true);
    const after = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const later = Date.now() + 5 * 60_000;
    const resume = { ...started.actions[0]!, client_uuid: randomUUID(), at: new Date(later).toISOString() };
    const done = { ...started.actions[1]!, at: new Date(later + 60_000).toISOString() };
    expect((await processActions(after, [resume, done] as never)).map((a) => a.status)).toEqual(['ok', 'ok']);
    const [v] = await serviceDb().select().from(visit).where(eq(visit.client_uuid, started.visit));
    expect(v!.departed_device_at).toBeTruthy();
    expect((await serviceDb().select().from(run_stop).where(eq(run_stop.id, stops[0]!.id)))[0]!.status).toBe('done');
    // A lot never started is still refused.
    expect((await processActions(after, [stopActions(stops[2]!.id, new Date(later)).actions[0]] as never))[0]).toMatchObject({ status: 'rejected', reason: 'storm_closed' });
  });
});
