import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { login, sql, startStorm } from './helpers';

/** STAR's QA of 4f738dd: issues 240 and 241. */
const once = (name: string) => test.skip(name !== 'iphone-13', 'once is enough');

test('Customers: "Quote this lot" keeps the link list on screen until Done, and the box reads right for one lot (issue 240)', async ({ page }, info) => {
  once(info.project.name);
  test.setTimeout(120_000);
  const tag = randomUUID().slice(0, 6);
  const email = `q240-${tag}@flake.test`;
  await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/dashboard');
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill(`Q240 ${tag}`);
  await page.getByTestId('agree-terms').check();
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/customers/import');
  await page.getByTestId('csv-text').fill(`name,address,label,kind,billing,phone\nOak ${tag},14701 Detroit Ave Lakewood OH,Main lot,commercial,invoice,216-555-0181`);
  await page.getByTestId('csv-import').click();
  await expect(page.getByTestId('import-results')).toContainText('1 lot added');
  await page.goto('/customers');
  const box = page.getByTestId('unquoted-lots');
  await expect(box).toContainText('1 lot has no quote yet, so it never triggers and isn’t billed.');
  await page.getByTestId('customers-quote-all').click();
  await expect(page.getByTestId('customers-quote-all-done')).toContainText('1 quote made');
  // Still there well after the quote: STAR saw it vanish by 0.7 s.
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('customers-quote-all-row')).toHaveCount(1);
  await expect(page.getByTestId('customers-quote-all-row')).toContainText(`Oak ${tag}`);
  await page.getByTestId('customers-quote-all-finished').click();
  await expect(box).toHaveCount(0);
});

test('driver at 390x664 on a salt lot: the Services chips clear the After photo panel on first view (issue 241)', async ({ browser, baseURL, page }, info) => {
  once(info.project.name);
  await login(page);
  const { id, runs } = await startStorm(page.request, `Chips ${Date.now()}`, ['West Lakewood']);
  const stopId = runs[0]!.stops[0]!.id;
  const [k] = await sql`select k.id, k.services, k.salt_pricing, s.lat, s.lon from run_stop rs join site s on s.id = rs.site_id join contract k on k.site_id = s.id and k.status = 'accepted' where rs.id = ${stopId} order by k.created_at desc limit 1`;
  // This lot is salted for the test; put back after.
  const services = [...(k!.services as { service: string }[]).filter((x) => x.service !== 'salt'), { service: 'salt', trigger_in: null }];
  await sql`update contract set services = ${sql.json(services as never)}, salt_pricing = ${sql.json({ unit: 'bag50lb', amount_cents: 1800 } as never)} where id = ${k!.id}`;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 664 }, geolocation: { latitude: Number(k!.lat), longitude: Number(k!.lon) }, permissions: ['geolocation'] });
  try {
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    await d.getByTestId('arrive').click();
    await expect(d.getByTestId('salt-row')).toBeVisible();
    await expect(d.getByTestId('no-photo-hint')).toBeVisible();
    const after = (await d.getByTestId('after-photo').locator('..').boundingBox())!;
    for (const chip of await d.locator('[data-testid^="service-"]').all()) {
      const b = (await chip.boundingBox())!;
      // Above the panel (the panel starts 8 px above the After photo button), and tappable where it is.
      expect(b.y + b.height).toBeLessThanOrEqual(after.y - 8);
      const hit = await d.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid^="service-"]')?.getAttribute('data-testid') ?? null, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
      expect(hit).toBe(await chip.getAttribute('data-testid'));
    }
    expect(await d.evaluate(() => window.scrollY)).toBe(0);
    // The hint goes away with the photo.
    await d.getByTestId('after-photo').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 130, b: 150 } } }).jpeg().toBuffer() });
    await expect(d.getByTestId('no-photo-hint')).toHaveCount(0);
  } finally {
    await ctx.close();
    await sql`update contract set services = ${sql.json(k!.services as never)}, salt_pricing = ${k!.salt_pricing === null ? null : sql.json(k!.salt_pricing as never)} where id = ${k!.id}`;
    await sql`update storm set status = 'closed', closed_at = now() where id = ${id}`;
  }
});
