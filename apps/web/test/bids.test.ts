import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, contract, eq, serviceDb, sql, withUser } from '@flake/db';
import { drain, makeWorld, req } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('issue 166: bids and renewals', () => {
  it('renews a signed contract into a draft for next season once, and moves a bid from lead to won only when signed', async () => {
    const { currentSeason } = await import('@flake/core/time');
    const { renewalQueue, renewContract, nextSeasonOf, renewalsOpen } = await import('@/lib/bids');
    const w = await makeWorld();
    const tz = 'America/New_York';
    const season = currentSeason(new Date(), tz);
    const next = nextSeasonOf(season);
    // The world's contracts are for 2026-27; make them this season's.
    await serviceDb().update(contract).set({ season }).where(eq(contract.tenant_id, w.tenantId));

    const q = await withUser(w.userId, (tx) => renewalQueue(tx, tz));
    expect(q.next).toBe(next);
    expect(q.rows).toHaveLength(5);
    const first = q.rows.find((r) => r.site_id === w.siteIds[0])!;
    const draft = await withUser(w.userId, (tx) => renewContract(tx, w.tenantId, first.contract_id));
    const [old] = await serviceDb().select().from(contract).where(eq(contract.id, first.contract_id));
    expect(draft).toMatchObject({ season: next, status: 'draft', site_id: w.siteIds[0] });
    expect(draft.services).toEqual(old!.services);
    expect(old!.status).toBe('accepted');
    // Once: a second renew is refused, and the lot leaves the queue.
    await expect(withUser(w.userId, (tx) => renewContract(tx, w.tenantId, first.contract_id))).rejects.toMatchObject({ code: 'already_renewed' });
    expect((await withUser(w.userId, (tx) => renewalQueue(tx, tz))).rows).toHaveLength(4);

    // Reminders start on the company's date in the summer before next season.
    const y = Number(season.slice(0, 4)) + 1;
    expect(renewalsOpen(`${y}-07-31`, '08-01', season)).toBe(true); // July 1 at the latest
    expect(renewalsOpen(`${y}-03-01`, '08-01', season)).toBe(false);
    expect(renewalsOpen(`${y}-03-01`, '03-01', season)).toBe(true);

    // A bid for the renewal: won only once the quote is accepted; lost needs a reason.
    const auth = await import('@/lib/auth');
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { POST } = await import('@/app/api/bids/route');
    const { PATCH } = await import('@/app/api/bids/[id]/route');
    const made = await POST(req('/api/bids', { method: 'POST', body: JSON.stringify({ customer_id: w.customerIds[0], site_ids: [w.siteIds[0]], season: next, estimated_cents: 250000 }) }), {} as never);
    expect(made.status).toBe(201);
    const bid = await made.json();
    const patch = (b: unknown) => PATCH(req(`/api/bids/${bid.id}`, { method: 'PATCH', body: JSON.stringify(b) }), { params: Promise.resolve({ id: bid.id }) });
    expect((await (await patch({ stage: 'quote_sent' })).json()).contract_id).toBe(draft.id);
    expect((await patch({ stage: 'won' })).status).toBe(409);
    await serviceDb().update(contract).set({ status: 'accepted' }).where(eq(contract.id, draft.id));
    expect((await patch({ stage: 'won' })).status).toBe(200);
    expect((await patch({ stage: 'lost' })).status).toBe(422);
    // A lot from another customer can't go on this bid; a prospect needs a name.
    expect((await POST(req('/api/bids', { method: 'POST', body: JSON.stringify({ customer_id: w.customerIds[0], site_ids: [w.siteIds[1]], season: next }) }), {} as never)).status).toBe(422);
    expect((await POST(req('/api/bids', { method: 'POST', body: JSON.stringify({ season: next }) }), {} as never)).status).toBe(422);
    spy.mockRestore();

    // Another company's contract can't be renewed from here.
    const other = await makeWorld();
    await expect(withUser(other.userId, (tx) => renewContract(tx, other.tenantId, first.contract_id))).rejects.toMatchObject({ status: 404 });
  });
});
