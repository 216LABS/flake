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
