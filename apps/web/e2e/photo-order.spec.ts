import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/** A driver's phone can send the after photo first. The customer still sees before, then after. */
test('the records page shows the before photo ahead of the after photo, whichever synced first', async ({ page, browser, baseURL }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Order ${randomUUID().slice(0, 6)}`, ['West Lakewood']);
  const run = runs[0]!;
  const counts = await sql`select s.id, (select count(*)::int from visit v where v.site_id = s.id) as n from site s where s.id in ${sql(run.stops.map((x) => x.site_id))}`;
  const stop = run.stops.find((x) => x.site_id === counts.sort((a, b) => a.n - b.n)[0]!.id)!;
  const [site] = await sql`select customer_id from site where id = ${stop.site_id}`;
  const token = new URL(run.link).pathname.split('/').pop()!;
  const visit = randomUUID();
  const at = Date.now() - 20 * 60_000;
  const act = await page.request.post(`/api/d/${token}/actions`, {
    data: {
      actions: [
        { client_uuid: randomUUID(), at: new Date(at).toISOString(), kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: visit, gps: null },
        { client_uuid: randomUUID(), at: new Date(at + 10 * 60_000).toISOString(), kind: 'done', run_stop_id: stop.id, visit_client_uuid: visit, services: ['plow'], depth_in: 3, gps: null },
      ],
    },
  });
  expect(act.ok(), await act.text()).toBe(true);
  const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer();
  for (const phase of ['after', 'before']) {
    const up = await page.request.post(`/api/d/${token}/photos`, { multipart: { file: { name: `${phase}.jpg`, mimeType: 'image/jpeg', buffer: jpg }, client_uuid: randomUUID(), visit_client_uuid: visit, phase } });
    expect(up.ok(), await up.text()).toBe(true);
  }

  const { url } = await (await page.request.get(`/api/customers/${site!.customer_id}/portal`)).json();
  const guest = await browser.newContext({ baseURL });
  const g = await guest.newPage();
  await g.goto(url);
  const labels = await g.getByRole('link', { name: /photo,/ }).evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  // The newest visit is first, and its photos read before, then after.
  expect(labels.slice(0, 2)).toEqual(['Before', 'After']);
  await guest.close();
  await closeRunningStorms();
});
