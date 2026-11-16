import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, crew_member, eq, invoice_draft, message_log, serviceDb, sql, storm, tenant } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

describe('Spanish-speaking drivers (issue 151)', () => {
  it('get their route link, call-out and invite in Spanish, and a "Sí" answers yes', async () => {
    const { renderTemplate, classifyInbound, emailFooter } = await import('@flake/core/messages');
    expect(renderTemplate('call_out', { company: 'Co', time: '4 AM', route: 'Oeste' }, 'es')).toBe('Co: Se espera quitar nieve ~4 AM. ¿Puedes hacer la ruta Oeste? Responde SI o NO.');
    // Customer messages have no Spanish version, so they stay in English.
    expect(renderTemplate('on_the_way', { company: 'Co', site: 'Lot' }, 'es')).toBe('Co: Your plow is on the way to Lot.');
    for (const yes of ['Sí', 'si', 'SI!', 'sí.']) expect(classifyInbound(yes, false), yes).toBe('yes');
    expect(emailFooter('crew_link', { name: 'Co' }, 'es')).toContain('Recibes esto porque estás en el equipo de Co');

    const { sendRunLink, publishStorm } = await import('@/lib/storms');
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(crew_member).set({ language: 'es' }).where(eq(crew_member.id, w.crewId));
    const out = await createStorm(ctxOf(w), { name: `Tormenta ${randomUUID().slice(0, 4)}`, routeIds: [w.routeId], crewAssignments: {} });
    await publishStorm(ctxOf(w), out.storm.id);
    await sendRunLink(w.tenantId, out.runs[0]!.id);
    await drain();
    const sent = await db.select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'crew_link')));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.body.includes('Hay tormenta. Ruta Route A'))).toBe(true);
    expect(sent.some((m) => m.body.includes('Responde STOP'))).toBe(false);
  });
});

describe('editable depth tiers on the rate card (issue 153)', () => {
  it('each depth deeper than the last, a last "above" tier, and multiples in range', async () => {
    const { tierProblem } = await import('@/lib/limits');
    expect(tierProblem([{ depth: '2', mult: '1' }, { depth: '6', mult: '1.5' }, { depth: '12', mult: '2' }, { depth: '', mult: '3' }])).toBeNull();
    expect(tierProblem([{ depth: '6', mult: '1' }, { depth: '4', mult: '1.5' }, { depth: '', mult: '2' }])).toMatch(/deeper than the one before/);
    expect(tierProblem([{ depth: '4', mult: '0' }, { depth: '', mult: '2' }])).toMatch(/between 0.1 and 10/);
    expect(tierProblem([{ depth: '', mult: '2' }])).toMatch(/at least two/);
  });
});

describe('a printable invoice (issue 146)', () => {
  it('renders for a bill past review, and only for the customer it belongs to', async () => {
    const { invoicePdf, invoiceNumber } = await import('@/lib/invoice-pdf');
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(tenant).set({ pay_instructions: 'Checks to Test Plow', address: { line1: '1 Yard Rd', city: 'Lakewood', state: 'OH', zip: '44107' } }).where(eq(tenant.id, w.tenantId));
    const [s] = await db.insert(storm).values({ tenant_id: w.tenantId, name: 'Invoice storm', started_at: new Date(Date.now() - 7200_000).toISOString(), closed_at: new Date().toISOString(), status: 'billed' }).returning();
    const lines = [{ site_id: w.siteIds[0], description: 'Site 0: Plow, Nov 14', quantity: 1, unit_cents: 6500, amount_cents: 6500, source_visit_ids: [] }];
    const [d] = await db.insert(invoice_draft).values({ tenant_id: w.tenantId, storm_id: s!.id, customer_id: w.customerIds[0]!, lines, subtotal_cents: 6500, flags: [], status: 'approved' }).returning();
    const out = await invoicePdf(w.tenantId, d!.id, w.customerIds[0]!);
    expect(out?.filename).toBe(`invoice-${invoiceNumber(d!.id)}.pdf`);
    expect(out!.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await invoicePdf(w.tenantId, d!.id, w.customerIds[1]!)).toBeNull();
    await db.update(invoice_draft).set({ status: 'draft' }).where(eq(invoice_draft.id, d!.id));
    expect(await invoicePdf(w.tenantId, d!.id)).toBeNull();
  });
});

describe('weather across the country', () => {
  it('a lot outside NWS coverage is marked checked and does not trip the shared weather breaker', async () => {
    const providers = await import('@/lib/providers');
    const { mapSites, breakerState } = await import('@/lib/weather');
    const { site } = await import('@flake/db');
    const { vi } = await import('vitest');
    const w = await makeWorld();
    const db = serviceDb();
    await db.update(site).set({ nws_mapped_at: null, nws_office: null }).where(eq(site.tenant_id, w.tenantId));
    const real = await providers.getProviders();
    const spy = vi.spyOn(providers, 'getProviders').mockResolvedValue({ ...real, weather: { ...real.weather, pointToGrid: async () => { throw new Error('NWS 404 for https://api.weather.gov/points/49.9,-97.1'); } } } as never);
    const before = (await breakerState()).failures;
    await mapSites(w.tenantId);
    spy.mockRestore();
    expect((await breakerState()).failures).toBe(before);
    const rows = await db.select().from(site).where(eq(site.tenant_id, w.tenantId));
    expect(rows.every((r) => r.nws_mapped_at && r.nws_office === null)).toBe(true);
    const { tenantWeatherHeader } = await import('@/lib/weather');
    expect((await tenantWeatherHeader(w.tenantId)).reason).toMatch(/no forecast for these lots/);
  });

  it('a tier lot nobody measured, with no NOAA total, is priced from a crew reading at a lot within 10 miles', async () => {
    const { generateDrafts } = await import('@/lib/billing');
    const { closeStorm } = await import('@/lib/storms');
    const { processActions, resolveToken } = await import('@/lib/driver');
    const { decryptToken } = await import('@/lib/tokens');
    const { run_stop } = await import('@flake/db');
    const { stopActions } = await import('./helpers');
    const w = await makeWorld();
    const out = await createStorm(ctxOf(w), { name: `Nearby ${randomUUID().slice(0, 4)}`, routeIds: [w.routeId], crewAssignments: {} });
    const rs = await resolveToken(decryptToken(out.runs[0]!.link_token_enc!));
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).sort((a, b) => a.seq - b.seq);
    // Push lot measured 5"; the tier lot (index 1, 0.1 km away) done with no depth.
    await processActions(rs, stopActions(stops[0]!.id, new Date(Date.now() - 50 * 60_000), { depth: 5 }).actions);
    const a = stopActions(stops[1]!.id, new Date(Date.now() - 30 * 60_000));
    (a.actions[1] as { depth_in: number | null }).depth_in = null;
    await processActions(rs, a.actions);
    await closeStorm(ctxOf(w), out.storm.id, true);
    await generateDrafts(ctxOf(w), out.storm.id);
    const [d] = await serviceDb().select().from(invoice_draft).where(and(eq(invoice_draft.storm_id, out.storm.id), eq(invoice_draft.customer_id, w.customerIds[1]!)));
    const line = (d!.lines as { description: string; amount_cents: number }[])[0]!;
    expect(line.amount_cents).toBe(25000);
    expect(line.description).toMatch(/for 5" of snow, measured at a lot nearby/);
  });
});

describe('admin pages on a hosted staging copy', () => {
  it('only ADMIN_EMAILS are platform admins on staging; a laptop or test run lets anyone in', async () => {
    const { isPlatformAdmin } = await import('@/lib/salt-orders');
    const { canSeeUsage } = await import('@/lib/usage');
    const before = { env: process.env.APP_ENV, admins: process.env.ADMIN_EMAILS };
    try {
      process.env.ADMIN_EMAILS = 'owner@216labs.example';
      process.env.APP_ENV = 'staging';
      expect(isPlatformAdmin('someone@example.com')).toBe(false);
      expect(canSeeUsage('someone@example.com')).toBe(false);
      expect(isPlatformAdmin('Owner@216labs.example')).toBe(true);
      process.env.APP_ENV = 'test';
      expect(isPlatformAdmin('someone@example.com')).toBe(true);
    } finally {
      process.env.APP_ENV = before.env;
      process.env.ADMIN_EMAILS = before.admins;
      if (before.admins === undefined) delete process.env.ADMIN_EMAILS;
    }
  });
});
