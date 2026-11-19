import { afterAll, describe, expect, it, vi } from 'vitest';
import { certificate, claim, closeDb, eq, serviceDb, sql, withUser } from '@flake/db';
import { drain, makeWorld, req } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const pdf = () => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], { type: 'application/pdf' });

describe('issue 165: insurance and claims', () => {
  it('takes a real PDF certificate, refuses a fake one, tracks sub cover, and keeps claims with their packets', async () => {
    const auth = await import('@/lib/auth');
    const { complianceOverview, complianceAlerts } = await import('@/lib/compliance');
    const w = await makeWorld();
    const spy = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { POST } = await import('@/app/api/certificates/route');
    const post = (fields: Record<string, string>, file: Blob | null) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      if (file) f.set('file', file, 'coi.pdf');
      return POST(req('/api/certificates', { method: 'POST', body: f }), {} as never);
    };
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    // The company's certificate, ending in 10 days.
    expect((await post({ kind: 'general_liability', insurer: 'Erie', expires_on: soon, is_default: 'true' }, pdf())).status).toBe(201);
    // No end date, a fake PDF, or a W-9 for the company are refused.
    expect((await post({ kind: 'general_liability' }, pdf())).status).toBe(422);
    expect((await post({ kind: 'auto', expires_on: soon }, new Blob(['not a pdf'], { type: 'application/pdf' }))).status).toBe(422);
    expect((await post({ kind: 'w9' }, pdf())).status).toBe(422);
    // The sub (Crew Two) has only a W-9: no cover.
    expect((await post({ kind: 'w9', crew_id: w.crew2Id }, pdf())).status).toBe(201);
    spy.mockRestore();

    const o = await withUser(w.userId, (tx) => complianceOverview(tx, 'America/New_York'));
    expect(o.company).toHaveLength(1);
    expect(o.company[0]).toMatchObject({ state: 'expiring', is_default: true });
    expect(o.subs.find((s) => s.id === w.crew2Id)!.coverage).toBe('missing');
    const alerts = await withUser(w.userId, (tx) => complianceAlerts(tx, 'America/New_York'));
    expect(alerts.map((a) => a.text)).toEqual([`Your Erie certificate ends ${soon}.`, 'Crew Two: has no certificate of insurance on file.']);

    // A claim on a lot, moved along.
    const [c] = await withUser(w.userId, (tx) => tx.insert(claim).values({ tenant_id: w.tenantId, site_id: w.siteIds[0]!, incident_at: new Date().toISOString(), reference: 'CL-1' }).returning());
    const spy2 = vi.spyOn(auth, 'requireApi').mockResolvedValue({ userId: w.userId, tenantId: w.tenantId, role: 'owner' } as never);
    const { PATCH } = await import('@/app/api/claims/[id]/route');
    expect((await PATCH(req(`/api/claims/${c!.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) }), { params: Promise.resolve({ id: c!.id }) })).status).toBe(200);
    // A packet id from nowhere can't be attached.
    expect((await PATCH(req(`/api/claims/${c!.id}`, { method: 'PATCH', body: JSON.stringify({ proof_packet_ids: [crypto.randomUUID()] }) }), { params: Promise.resolve({ id: c!.id }) })).status).toBe(404);
    spy2.mockRestore();
    expect((await serviceDb().select().from(claim).where(eq(claim.id, c!.id)))[0]!.status).toBe('pending');

    // Another company sees none of it, and a viewer can't add a certificate.
    const other = await makeWorld();
    expect((await withUser(other.userId, (tx) => complianceOverview(tx, 'America/New_York'))).company).toHaveLength(0);
    await expect(withUser(w.viewerId, (tx) => tx.insert(certificate).values({ tenant_id: w.tenantId, kind: 'other', expires_on: soon }))).rejects.toThrow();
  });
});
