import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeRunningStorms, login, sql } from './helpers';

/** A lot whose customer declined or never signed bills nothing, so the office sees that before a truck goes out. */
test('a lot with no accepted contract is marked on Routes and on the storm board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await closeRunningStorms();
  const tag = randomUUID().slice(0, 6);
  const lot = async (name: string, signed: boolean) => {
    const c = await (await page.request.post('/api/customers', { data: { name: `${name} ${tag}`, kind: 'residential', billing_mode: 'card_on_file' } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `${name} drive ${tag}`, address: '1 Sign St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
    const k = await (await page.request.post('/api/contracts', { data: { site_id: s.id, season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 5000 } }] } })).json();
    await sql`update contract set status = ${signed ? 'accepted' : 'declined'} where id = ${k.id}`;
    return { c, s };
  };
  const signed = await lot('Signed', true);
  const declined = await lot('Declined', false);
  const [crew] = await sql`select c.id from crew_member c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.active limit 1`;
  const route = await (await page.request.post('/api/routes', { data: { name: `Contract check ${tag}`, default_crew_id: crew!.id, site_ids: [signed.s.id, declined.s.id] } })).json();

  await page.goto('/routes');
  const card = page.getByTestId('route-card').filter({ has: page.getByLabel(`Add a site to Contract check ${tag}`) });
  await expect(card.getByTestId('route-no-contract')).toHaveCount(1);
  await expect(card.locator('li').filter({ hasText: `Declined drive ${tag}` }).getByTestId('route-no-contract')).toBeVisible();

  const { id } = await (await page.request.post('/api/storms', { data: { name: `Contract check ${tag}`, routeIds: [route.id] } })).json();
  await page.goto(`/storms/${id}`);
  const stop = (label: string) => page.getByTestId('stop-card').filter({ hasText: label });
  await expect(stop(`Declined drive ${tag}`).getByTestId('no-contract')).toHaveText("No accepted contract: this lot won't be billed");
  await expect(stop(`Signed drive ${tag}`).getByTestId('no-contract')).toHaveCount(0);
  await closeRunningStorms();
  await page.request.patch(`/api/routes/${route.id}`, { data: { archived: true } });
  await sql`update customer set archived_at = now() where id in (${signed.c.id}, ${declined.c.id})`;
});
