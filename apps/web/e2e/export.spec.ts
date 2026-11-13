import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeRunningStorms, finishStops, login, sql, type LiveRun } from './helpers';

/**
 * The QuickBooks file is what goes into the books: only invoices someone approved, and a card on file is due on
 * receipt, not in 30 days.
 */
test('QuickBooks export has approved invoices only, with terms that match how each customer pays', async ({ page }) => {
  await login(page);
  await closeRunningStorms();
  const tag = randomUUID().slice(0, 6);
  const make = async (name: string, billing_mode: string, lat: number) => {
    const c = await (await page.request.post('/api/customers', { data: { name: `${name} ${tag}`, kind: 'commercial', billing_mode, email: `${name.toLowerCase()}-${tag}@example.com` } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `${name} lot ${tag}`, address: '1 Books St, Lakewood, OH', lat, lon: -81.8 } })).json();
    const k = await (await page.request.post('/api/contracts', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 1, pricing: { type: 'per_push', amount_cents: 10000 } }] } })).json();
    await sql`update contract set status = 'accepted' where id = ${k.id}`;
    return { c, s };
  };
  const card = await make('Card', 'card_on_file', 41.481);
  const net = await make('Net', 'invoice_net30', 41.482);
  const [crew] = await sql`select c.id from crew_member c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.active limit 1`;
  const route = await (await page.request.post('/api/routes', { data: { name: `Books ${tag}`, default_crew_id: crew!.id, site_ids: [card.s.id, net.s.id] } })).json();
  const { id } = await (await page.request.post('/api/storms', { data: { name: `Books ${tag}`, routeIds: [route.id] } })).json();
  const pub = await page.request.post(`/api/storms/${id}/publish`);
  expect(pub.ok(), await pub.text()).toBe(true);
  const live = await (await page.request.get(`/api/storms/${id}/live`)).json();
  await finishStops(page.request, live.runs[0] as LiveRun);
  const closed = await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
  expect(closed.ok(), await closed.text()).toBe(true);
  const drafted = await page.request.post(`/api/storms/${id}/billing/draft`);
  expect(drafted.ok(), await drafted.text()).toBe(true);

  const csv = async () => (await page.request.get(`/api/billing/export.csv?storm=${id}`)).text();
  // Nothing approved yet: nothing to put in the books.
  expect((await csv()).trim().split('\n')).toHaveLength(1);

  await sql`update invoice_draft set status = 'approved' where storm_id = ${id} and customer_id = ${card.c.id}`;
  const one = (await csv()).trim().split('\n');
  expect(one).toHaveLength(2);
  const [, , invDate, dueDate, terms] = one[1]!.split(',');
  expect(one[1]).toContain(`Card ${tag}`);
  expect(terms).toBe('Due on receipt');
  expect(dueDate).toBe(invDate);

  await sql`update invoice_draft set status = 'sent' where storm_id = ${id} and customer_id = ${net.c.id}`;
  const both = (await csv()).trim().split('\n');
  expect(both).toHaveLength(3);
  const netRow = both.find((l) => l.includes(`Net ${tag}`))!;
  expect(netRow.split(',')[4]).toBe('Net 30');
  await sql`update customer set archived_at = now() where id in (${card.c.id}, ${net.c.id})`;
  await page.request.patch(`/api/routes/${route.id}`, { data: { archived: true } });
});

test('a request with the same mistake many times says it once', async ({ page }) => {
  await login(page);
  const res = await page.request.post('/api/billing/approve', { data: { draftIds: ['x', 'y', 'z'] } });
  expect(res.status()).toBe(422);
  const { error } = await res.json();
  expect(error).toBe("Draft ids isn't in the right format.");
});
