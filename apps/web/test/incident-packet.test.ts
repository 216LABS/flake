import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, problem_report, run_stop, serviceDb, site, sql, storm } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, stopActions } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('the incident packet for a slip-and-fall claim (issue 163)', () => {
  it('names the last service before and the next after, the freezes between, the crew\'s problem report, and hashes the same when made again', async () => {
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { decryptToken } = await import('@/lib/tokens');
    const { assembleProof, renderProof } = await import('@/lib/proof');
    const { buildManifest } = await import('@flake/core/proof');
    const { incidentFacts } = await import('@flake/providers/pdf');
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(site).set({ nws_station: 'KCLE' }).where(eq(site.id, w.siteIds[0]!));
    const out = await createStorm(ctxOf(w), { name: 'Before the slip', routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await db.select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id)).orderBy(run_stop.seq).limit(1);
    // Plowed and salted 30 hours before the slip.
    const slip = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 2 * 3_600_000);
    await processActions(rs, stopActions(stop!.id, new Date(slip.getTime() - 30 * 3_600_000), { services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 4 }] }).actions);
    await db.insert(problem_report).values({ tenant_id: w.tenantId, site_id: w.siteIds[0]!, crew_id: w.crewId, kind: 'other', note: 'Ice under the drift by door 3', created_at: new Date(slip.getTime() - 29 * 3_600_000).toISOString() });
    await db.update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, out.storm.id));

    const from = new Date(slip.getTime() - 72 * 3_600_000).toISOString();
    const to = new Date(slip.getTime() + 24 * 3_600_000).toISOString();
    const input = await assembleProof(w.tenantId, w.siteIds[0]!, from, to, slip.toISOString());
    expect(input.incident_at).toBe(slip.toISOString());
    expect(input.problems?.map((p) => p.note)).toEqual(['Ice under the drift by door 3']);
    expect(input.observations?.station).toBe('KCLE');
    expect(input.observations?.rows.length).toBeGreaterThan(48);
    const { manifest, hash } = buildManifest(input);
    const f = incidentFacts(manifest);
    expect(f.before?.services).toEqual(['plow', 'salt']);
    expect(f.after).toBeNull();
    // The demo data thaws every afternoon and freezes every night: at least one freeze in the 30 hours since.
    expect(f.freezes.length).toBeGreaterThan(0);
    // Made again with nothing changed: the same station snapshot is reused, so the same hash.
    expect(buildManifest(await assembleProof(w.tenantId, w.siteIds[0]!, from, to, slip.toISOString())).hash).toBe(hash);
    const packet = await renderProof({ tenantId: w.tenantId, siteId: w.siteIds[0]!, from, to, incidentAt: slip.toISOString() });
    expect(packet?.manifest_sha256).toBe(hash);
  });

  it('a lot with no station or no visits still makes a packet that says so', async () => {
    const { assembleProof } = await import('@/lib/proof');
    const { buildManifest } = await import('@flake/core/proof');
    const { incidentFacts } = await import('@flake/providers/pdf');
    const w = await makeWorld();
    const now = new Date();
    const input = await assembleProof(w.tenantId, w.siteIds[1]!, new Date(now.getTime() - 72 * 3_600_000).toISOString(), now.toISOString(), now.toISOString());
    expect(input.observations).toBeUndefined();
    const f = incidentFacts(buildManifest(input).manifest);
    expect([f.before, f.after, f.freezes]).toEqual([null, null, []]);
  });
});
