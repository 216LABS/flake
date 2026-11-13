import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeRunningStorms, login, sql } from './helpers';

/** A 1" storm on 2" contracts: billing asks first, and the office can bill it anyway or leave it off. */
test('a lot plowed under its trigger is flagged, and Bill it anyway or Don\'t bill each settle it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await closeRunningStorms();
  const tag = randomUUID().slice(0, 6);
  const lot = async (name: string, lat: number) => {
    const c = await (await page.request.post('/api/customers', { data: { name: `${name} ${tag}`, kind: 'commercial', billing_mode: 'invoice_net30' } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `${name} lot ${tag}`, address: '1 Trigger St, Lakewood, OH', lat, lon: -81.8 } })).json();
    const k = await (await page.request.post('/api/contracts', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 12000 } }] } })).json();
    await sql`update contract set status = 'accepted' where id = ${k.id}`;
    return { c, s };
  };
  const anyway = await lot('Anyway', 41.4811);
  const skip = await lot('Skip', 41.4822);
  const [crew] = await sql`select c.id from crew_member c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.active limit 1`;
  const route = await (await page.request.post('/api/routes', { data: { name: `Trigger ${tag}`, default_crew_id: crew!.id, site_ids: [anyway.s.id, skip.s.id] } })).json();
  const { id } = await (await page.request.post('/api/storms', { data: { name: `Trigger ${tag}`, routeIds: [route.id] } })).json();
  expect((await page.request.post(`/api/storms/${id}/publish`)).ok()).toBe(true);
  const live = await (await page.request.get(`/api/storms/${id}/live`)).json();
  const run = live.runs[0];
  const token = new URL(run.link).pathname.split('/').pop()!;
  for (const [i, stop] of run.stops.entries()) {
    const [st] = await sql`select lat, lon from site where id = ${stop.site_id}`;
    const v = randomUUID();
    const at = Date.now() - 3600_000 + i * 1800_000;
    const res = await page.request.post(`/api/d/${token}/actions`, { data: { actions: [
      { client_uuid: randomUUID(), at: new Date(at).toISOString(), kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: v, gps: { lat: st!.lat, lon: st!.lon, acc: 5 } },
      { client_uuid: randomUUID(), at: new Date(at + 900_000).toISOString(), kind: 'done', run_stop_id: stop.id, visit_client_uuid: v, services: ['plow'], depth_in: 1, gps: null },
    ] } });
    expect(res.ok()).toBe(true);
  }
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
  await page.request.post(`/api/storms/${id}/billing/draft`);
  await page.goto(`/billing?storm=${id}`);

  const card = (name: string) => page.getByTestId('draft').filter({ hasText: `${name} ${tag}` });
  const flagIn = (name: string) => card(name).locator('[data-code="below_trigger"]');
  await expect(flagIn('Anyway')).toContainText('under the 2" this contract starts at');
  await flagIn('Anyway').getByTestId('fix-bill-anyway').click();
  await expect(flagIn('Anyway')).toContainText('(waived)');
  await expect(card('Anyway')).toContainText('$120.00');

  await flagIn('Skip').getByTestId('fix-no-bill').click();
  await expect(flagIn('Skip')).toContainText('Not billed for this storm.');
  await expect(card('Skip')).toContainText('$0.00');
  await page.request.patch(`/api/routes/${route.id}`, { data: { archived: true } });
  await sql`update customer set archived_at = now() where id in (${anyway.c.id}, ${skip.c.id})`;
});
