import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, crew_member, eq, run_stop, serviceDb, site, storm } from '@flake/db';
import { proofRequest } from '@flake/contracts';
import { currentSeason } from '@flake/core/time';
import { billInstallments, generateDrafts } from '@/lib/billing';
import { processActions, resolveToken } from '@/lib/driver';
import { appEnv } from '@/lib/env';
import { portalData } from '@/lib/portal';
import { acceptQuote, createQuote } from '@/lib/quotes';
import { period } from '@/lib/reports';
import { closeStorm, publishStorm, revokeRunLink } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, makeWorld, createStorm } from './helpers';

afterAll(() => closeDb());

const seasonal = [{ service: 'plow', trigger_in: 2, pricing: { type: 'seasonal', total_cents: 300000, installments: 5 } }];

describe('seasonal installments', () => {
  it('stop for a retired lot', async () => {
    const x = await makeWorld();
    await serviceDb().update(site).set({ active: false }).where(eq(site.id, x.siteIds[3]!));
    expect(await billInstallments(x.tenantId)).toBe(0);
  });

  it('bill one contract per lot and season, the newest', async () => {
    const x = await makeWorld();
    const [old] = await serviceDb().select().from(contract).where(eq(contract.site_id, x.siteIds[3]!));
    await serviceDb().insert(contract).values({ tenant_id: x.tenantId, site_id: x.siteIds[3]!, season: old!.season, status: 'accepted', services: seasonal });
    expect(await billInstallments(x.tenantId)).toBe(1);
  });

  it('a renewal for next season does not stop this season', async () => {
    const x = await makeWorld();
    await serviceDb().insert(contract).values({ tenant_id: x.tenantId, site_id: x.siteIds[3]!, season: '2099-00', status: 'accepted', services: seasonal });
    expect(await billInstallments(x.tenantId)).toBe(2);
  });
});

describe('signing a new quote for the same season', () => {
  it('replaces the old agreement, and a next-season renewal does not', async () => {
    const x = await makeWorld();
    const siteId = x.siteIds[0]!;
    const [old] = await serviceDb().select().from(contract).where(eq(contract.site_id, siteId));
    const next = await createQuote(ctxOf(x), { site_id: siteId, season: '2099-00', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7000 } }], send: false });
    await acceptQuote(next.token, { name: 'Pat Renew', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null);
    expect((await serviceDb().select().from(contract).where(eq(contract.id, old!.id)))[0]!.status).toBe('accepted');
    const again = await createQuote(ctxOf(x), { site_id: siteId, season: old!.season, services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 7500 } }], send: false });
    await acceptQuote(again.token, { name: 'Pat Requote', agree: true, consentSms: false, consentEmail: true, phone_e164: null }, null);
    expect((await serviceDb().select().from(contract).where(eq(contract.id, old!.id)))[0]!.status).toBe('void');
    const live = await serviceDb().select().from(contract).where(and(eq(contract.site_id, siteId), eq(contract.status, 'accepted')));
    expect(live.map((c) => c.season).sort()).toEqual([old!.season, '2099-00'].sort());
  });
});

describe('the customer records page', () => {
  it('says the crew is on site only while the storm is on', async () => {
    const x = await makeWorld();
    const ctx = ctxOf(x);
    const out = await createStorm(ctx, { name: 'Left early', routeIds: [x.routeId], crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.site_id, x.siteIds[1]!)));
    await processActions(rs, [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'arrive', run_stop_id: stop!.id, visit_client_uuid: randomUUID(), gps: null }]);
    const during = await portalData(x.customerIds[1]!, x.tenantId);
    expect(during!.sites[0]!.visits[0]!.on_site_now).toBe(true);
    await closeStorm(ctx, out.storm.id, true);
    expect((await serviceDb().select().from(storm).where(eq(storm.id, out.storm.id)))[0]!.status).toBe('closed');
    const after = await portalData(x.customerIds[1]!, x.tenantId);
    expect(after!.sites[0]!.visits[0]!.on_site_now).toBe(false);
  });
});

describe('inputs', () => {
  it('an impossible date in a report link falls back instead of crashing', () => {
    const p = period('2026-13-45', '2026-02-31', 'America/New_York');
    expect(p.to).not.toBe('2026-02-31');
    expect(Number.isNaN(Date.parse(p.startAt))).toBe(false);
  });

  it('a proof packet needs a start before its end and two years at most', () => {
    const site = randomUUID();
    expect(proofRequest.safeParse({ siteId: site, from: '2026-03-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success).toBe(false);
    expect(proofRequest.safeParse({ siteId: site, from: '2016-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success).toBe(false);
    expect(proofRequest.safeParse({ siteId: site, from: '2025-10-01T00:00:00Z', to: '2026-04-30T00:00:00Z' }).success).toBe(true);
  });

  it('seasons follow the calendar instead of a year typed into the code', () => {
    expect(currentSeason(new Date('2026-11-09T12:00:00'))).toBe('2026-27');
    expect(currentSeason(new Date('2027-02-01T12:00:00'))).toBe('2026-27');
    expect(currentSeason(new Date('2027-08-01T12:00:00'))).toBe('2027-28');
  });
});

describe('deployment', () => {
  it('a live Vercel deployment with no APP_ENV still counts as production', () => {
    const saved = { app: process.env.APP_ENV, vercel: process.env.VERCEL_ENV };
    try {
      delete process.env.APP_ENV;
      process.env.VERCEL_ENV = 'production';
      expect(appEnv()).toBe('production');
      process.env.APP_ENV = 'staging';
      expect(appEnv()).toBe('staging');
      delete process.env.APP_ENV;
      process.env.VERCEL_ENV = 'preview';
      expect(appEnv()).toBe('local');
    } finally {
      process.env.APP_ENV = saved.app;
      if (saved.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.vercel;
    }
  });
});

describe('a renewal signed for next winter', () => {
  it('does not price this storm', async () => {
    const x = await makeWorld();
    // Customer 0 pays $65 a push this season and signs next season at $99.
    await serviceDb().insert(contract).values({ tenant_id: x.tenantId, site_id: x.siteIds[0]!, season: '2099-00', status: 'accepted', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9900 } }] });
    const ctx = ctxOf(x);
    const out = await createStorm(ctx, { name: 'This winter', routeIds: [x.routeId], crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const [stop] = await serviceDb().select().from(run_stop).where(and(eq(run_stop.storm_run_id, out.runs[0]!.id), eq(run_stop.site_id, x.siteIds[0]!)));
    const v = randomUUID();
    const at = Date.now() - 3600_000;
    await processActions(rs, [
      { client_uuid: randomUUID(), at: new Date(at).toISOString(), kind: 'arrive', run_stop_id: stop!.id, visit_client_uuid: v, gps: null },
      { client_uuid: randomUUID(), at: new Date(at + 1200_000).toISOString(), kind: 'done', run_stop_id: stop!.id, visit_client_uuid: v, services: ['plow'], depth_in: 3, salt: null, gps: null },
    ]);
    await closeStorm(ctx, out.storm.id, true);
    const drafts = await generateDrafts(ctx, out.storm.id);
    expect(drafts.find((d) => d.draft.customer_id === x.customerIds[0])!.draft.subtotal_cents).toBe(6500);
  });
});

describe('replacing a route link', () => {
  it('is refused for a driver who left the crew, so it cannot give them access back', async () => {
    const x = await makeWorld();
    const ctx = ctxOf(x);
    const out = await createStorm(ctx, { name: 'Left', routeIds: [x.routeId], crewAssignments: {} });
    await serviceDb().update(crew_member).set({ active: false }).where(eq(crew_member.id, x.crewId));
    await expect(revokeRunLink(ctx, out.runs[0]!.id)).rejects.toMatchObject({ status: 422 });
  });
});
