import { expect, test } from '@playwright/test';
import { login, sql, startStorm } from './helpers';

test('a signed contract can be voided but never edited or pulled back to draft', async ({ page }) => {
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [s] = await sql`select id from site where tenant_id = ${t!.id} and active limit 1`;
  const services = [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } }];
  const [c] = await sql`insert into contract (tenant_id, site_id, season, status, services, accepted_at, accepted_name) values (${t!.id}, ${s!.id}, '2031-32', 'accepted', ${sql.json(services)}, now(), 'Guard Test') returning id`;
  const patch = (data: unknown) => page.request.patch(`/api/contracts/${c!.id}`, { data });
  expect((await patch({ services: [{ ...services[0], pricing: { type: 'per_push', amount_cents: 99900 } }] })).status()).toBe(409);
  expect((await patch({ status: 'draft' })).status()).toBe(409);
  const [still] = await sql`select status, services from contract where id = ${c!.id}`;
  expect(still).toMatchObject({ status: 'accepted', services });
  expect((await patch({ status: 'void' })).status()).toBe(200);
  expect((await patch({ status: 'draft' })).status()).toBe(409);
  await sql`delete from contract where id = ${c!.id}`;
});

test('taking someone off the crew kills their route link at once', async ({ page }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, 'Crew leaves', ['Rocky River']);
  const run = runs[0]!;
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [c] = await sql`insert into crew_member (tenant_id, name, kind, email) values (${t!.id}, 'Leaving Soon', 'employee', ${`leaving-${Date.now()}@flake.test`}) returning id`;
  expect((await page.request.patch(`/api/runs/${run.id}`, { data: { crew_id: c!.id } })).ok()).toBe(true);
  const token = new URL(run.link).pathname.split('/')[2]!;
  expect((await page.request.get(`/api/d/${token}/run`)).status()).toBe(200);
  expect((await page.request.delete(`/api/crew/${c!.id}`)).ok()).toBe(true);
  expect((await page.request.get(`/api/d/${token}/run`)).status()).toBe(410);
  // They can't be put back on a run either.
  expect((await page.request.patch(`/api/runs/${run.id}`, { data: { crew_id: c!.id } })).status()).toBe(422);
  await page.request.post(`/api/storms/${stormId}/close`, { data: { force: true } });
});
