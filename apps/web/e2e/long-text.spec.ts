import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/**
 * People type anything: a customer's note with no spaces, a pasted link, a long email. Found by a random-input crash
 * hunt, where one long word in a customer's visit request pushed the office dashboard 1,900px wide on a phone.
 */
const LONG = 'x'.repeat(180);

async function fits(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(1);
}

for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test(`long unbroken text never pushes a page sideways at ${size.width} wide`, async ({ page, browser, baseURL }) => {
    await page.setViewportSize(size);
    await login(page);
    const tag = randomUUID().slice(0, 6);
    const c = await (await page.request.post('/api/customers', { data: { name: `Long${LONG}${tag}`, kind: 'commercial', email: `${tag}@example.com`, billing_mode: 'manual' } })).json();
    const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Lot${LONG}`, address: `100 ${LONG} St, Lakewood, OH`, lat: 41.48, lon: -81.8 } })).json();
    expect(s.id, JSON.stringify(s)).toBeTruthy();

    // The customer asks for a visit with a long note; a driver reports a problem with one.
    const { url: portal } = await (await page.request.get(`/api/customers/${c.id}/portal`)).json();
    const ptoken = new URL(portal).pathname.split('/').pop()!;
    const asked = await page.request.post(`/api/c/${ptoken}/request`, { data: { site_id: s.id, note: `Please${LONG}` } });
    expect(asked.ok(), await asked.text()).toBe(true);
    const { id, runs } = await startStorm(page.request, `Long ${tag}`, ['West Lakewood']);
    const run = runs[0]!;
    const token = new URL(run.link).pathname.split('/').pop()!;
    await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: run.stops[0]!.id, problem: 'other', note: `Gate${LONG}` }] } });
    await page.request.post(`/api/runs/${run.id}/stops`, { data: { site_id: s.id } });

    for (const path of ['/dashboard', '/storms', `/storms/${id}`, '/customers', `/customers/${c.id}`, `/sites/${s.id}`, '/routes', '/billing']) {
      await page.goto(path);
      await fits(page, path);
    }
    const guest = await browser.newContext({ baseURL, viewport: size, isMobile: true, hasTouch: true });
    const g = await guest.newPage();
    await g.goto(run.link);
    await fits(g, 'driver page');
    await g.goto(portal);
    await fits(g, 'records page');
    await guest.close();
    await sql`update customer set archived_at = now() where id = ${c.id}`;
    await closeRunningStorms();
  });
}
