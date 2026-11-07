import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { login, routeByName, sql, startStorm } from './helpers';

const smallPhoto = async () => ({
  name: 'p.jpg',
  mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 2600, height: 1950, channels: 3, background: { r: 120, g: 150, b: 180 } } }).jpeg({ quality: 80 }).toBuffer(),
});

/** Random noise barely compresses, which makes a realistic 5 MB+ full-size phone photo. */
const bigPhoto = async () => {
  const width = 3200;
  const height = 2400;
  const buffer = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  expect(buffer.length).toBeGreaterThan(4.5 * 1024 * 1024);
  return { name: 'big.jpg', mimeType: 'image/jpeg', buffer };
};

test('a photo over the host request limit goes straight to storage and lands once', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Big ${Date.now()}`, ['Rocky River']);
  const direct: string[] = [];
  const posted: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/storage/')) direct.push(r.url());
    if (r.method() === 'POST' && r.url().endsWith('/photos')) posted.push(r.postDataBuffer()?.length ?? 0);
  });
  await page.goto(runs[0]!.link);
  await page.getByTestId('arrive').click();
  const file = await bigPhoto();
  await page.getByTestId('before-photo').setInputFiles(file);
  await expect.poll(async () => (await sql`select count(*)::int as n from visit_photo p join visit v on v.id = p.visit_id where v.storm_id = ${id}`)[0]!.n, { timeout: 60000 }).toBe(1);
  expect(direct).toHaveLength(1);
  expect(posted).toEqual([]);
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'synced', { timeout: 30000 });
});

test('after reporting a Problem on site, the driver can get back in and finish', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Resume ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  const label = await page.getByTestId('stop-label').textContent();
  await page.getByTestId('arrive').click();
  await page.getByTestId('depth-3').click();
  await page.getByTestId('problem').click();
  await page.getByTestId('problem-blocked').click();
  await expect(page.getByTestId('stop-label')).toHaveText(label!);
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  await page.getByTestId('after-photo').setInputFiles(await smallPhoto());
  await page.getByTestId('done').click();
  await expect(page.getByTestId('progress')).toContainText('1 of');
  await expect.poll(async () => (await sql`select count(*)::int as n from visit where storm_id = ${id} and departed_device_at is not null`)[0]!.n, { timeout: 30000 }).toBe(1);
  expect((await sql`select count(*)::int as n from visit where storm_id = ${id}`)[0]!.n).toBe(1);
});

test('a driver set to Spanish sees Spanish the first time they open the link', async ({ page }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Spanish ${Date.now()}`, ['East Lakewood + Cleveland West']);
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('arrive')).toHaveText('Llegué');
  await page.getByTestId('lang').click();
  await expect(page.getByTestId('arrive')).toHaveText('Arrive');
  await page.reload();
  await expect(page.getByTestId('arrive')).toHaveText('Arrive');
});

test('night mode text meets 7:1 contrast', async ({ page }) => {
  await login(page);
  const { runs } = await startStorm(page.request, `Contrast ${Date.now()}`, ['West Lakewood']);
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();
  const check = () =>
    page.evaluate(() => {
      // Tailwind 4 colors compute to oklch(), so read the real pixel through a canvas.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const parse = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const bgOf = (el: Element | null): number[] => {
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c[3] === 255) return c;
        }
        return [255, 255, 255];
      };
      const bad: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
        if (!own || (el as HTMLElement).offsetParent === null || (el as HTMLButtonElement).disabled || el.tagName === 'SCRIPT') continue;
        const fg = lum(parse(getComputedStyle(el).color));
        const bg = lum(bgOf(el));
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        if (ratio < 7) bad.push(`${el.textContent?.slice(0, 24)}: ${ratio.toFixed(1)}`);
      }
      return bad;
    });
  expect(await check()).toEqual([]);
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  expect(await check()).toEqual([]);
});

test('malformed ids are a 404, never a crash', async ({ page }) => {
  await login(page);
  for (const path of ['/storms/not-a-uuid', '/storms/not-a-uuid/pay', '/alerts/not-a-uuid', '/customers/not-a-uuid', '/sites/not-a-uuid', '/billing?storm=not-a-uuid']) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
    await expect(page.getByText("We couldn't find that page")).toBeVisible();
  }
  for (const path of ['/api/customers/not-a-uuid', '/api/storms/not-a-uuid/live', '/api/proof/not-a-uuid']) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect((await page.request.get(`/api/billing/export.csv?storm=not-a-uuid`)).status()).toBe(404);
});

test('saving part of a record leaves everything else alone', async ({ page }) => {
  await login(page);
  const route = await routeByName('Rocky River');
  const before = (await sql`select count(*)::int as n from route_stop where route_id = ${route.id}`)[0]!.n;
  expect(before).toBeGreaterThan(0);
  const renamed = await page.request.patch(`/api/routes/${route.id}`, { data: { name: 'Rocky River' } });
  expect(renamed.ok()).toBe(true);
  expect((await sql`select count(*)::int as n from route_stop where route_id = ${route.id}`)[0]!.n).toBe(before);

  const [c] = await sql`select c.id, c.billing_mode from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.billing_mode = 'invoice_net30' limit 1`;
  await page.request.patch(`/api/customers/${c!.id}`, { data: { contact_name: 'Changed' } });
  expect((await sql`select billing_mode from customer where id = ${c!.id}`)[0]!.billing_mode).toBe('invoice_net30');

  const [st] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' and s.priority = 1 limit 1`;
  await page.request.patch(`/api/sites/${st!.id}`, { data: { notes: 'Changed' } });
  expect((await sql`select priority from site where id = ${st!.id}`)[0]!.priority).toBe(1);

  const [crew] = await sql`select id from crew_member where email = 'marisol@flake.test'`;
  await page.request.patch(`/api/crew/${crew!.id}`, { data: { name: 'Marisol Sample' } });
  expect((await sql`select language from crew_member where id = ${crew!.id}`)[0]!.language).toBe('es');
});

test('removing something still in use explains itself', async ({ page }) => {
  await login(page);
  const [c] = await sql`select c.id from customer c join tenant t on t.id = c.tenant_id join site s on s.customer_id = c.id where t.slug = 'lakeshore-demo' limit 1`;
  const res = await page.request.delete(`/api/customers/${c!.id}`);
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain('still in use');
});

test('a real magic link signs a new person in and lands on company setup', async ({ page }) => {
  const email = `magic-${Date.now()}-${test.info().project.name}@flake.test`;
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('send-link').click();
  await expect(page.getByTestId('link-sent')).toBeVisible();
  let text = '';
  await expect.poll(async () => {
    const search = await page.request.get(`http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const found = (await search.json()) as { messages?: { ID: string }[] };
    if (!found.messages?.length) return false;
    const msg = await page.request.get(`http://127.0.0.1:55324/api/v1/message/${found.messages[0]!.ID}`);
    text = ((await msg.json()) as { Text: string }).Text;
    return true;
  }, { timeout: 20000 }).toBe(true);
  const link = /https?:\/\/\S+verify\S+/.exec(text)![0]!.replace(/[)\]]+$/, '');
  await page.goto(link);
  await page.waitForURL('**/onboarding');
  await page.getByTestId('company').fill('Magic Link Plow');
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');
});

test('a stop can be dragged between columns on the board', async ({ browser, baseURL }) => {
  // HTML5 drag is a desktop gesture, and touch emulation never fires it. Phones use the Move to menu.
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  await login(page);
  const { id, runs } = await startStorm(page.request, `Drag ${Date.now()}`, ['West Lakewood', 'Rocky River']);
  const west = runs.find((r) => r.name === 'West Lakewood')!;
  const river = runs.find((r) => r.name === 'Rocky River')!;
  await page.goto(`/storms/${id}`);
  const stop = west.stops[0]!;
  await page.getByTestId('stop-card').filter({ hasText: stop.label }).dragTo(page.locator(`[data-run="${river.id}"]`), { sourcePosition: { x: 60, y: 10 }, targetPosition: { x: 100, y: 20 } });
  await expect(page.locator(`[data-run="${river.id}"]`).getByText(stop.label)).toBeVisible();
  await expect.poll(async () => (await sql`select storm_run_id from run_stop where id = ${stop.id}`)[0]!.storm_run_id).toBe(river.id);
  await desktop.close();
});

test('the map draws an area and measures walks in the new customer wizard', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/customers/new');
  await page.getByTestId('c-name').fill(`Map ${Date.now()}`);
  await page.getByTestId('next').click();
  await page.getByTestId('address').fill('14701 Detroit Ave, Lakewood, OH');
  await page.getByTestId('find').click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  const map = page.getByTestId('map');
  await expect(map.locator('canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('sqft')).toContainText('unavailable');
  for (const position of [{ x: 150, y: 80 }, { x: 350, y: 80 }, { x: 350, y: 220 }]) await map.click({ position });
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  const drawn = Number((await page.getByTestId('sqft').textContent())!.replace(/\D/g, ''));
  expect(drawn).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Draw / edit area' }).click();
  await page.getByRole('button', { name: 'Measure walks' }).click();
  for (const position of [{ x: 100, y: 250 }, { x: 400, y: 250 }]) await map.click({ position });
  await expect(page.getByLabel('Walks (ft)')).not.toHaveValue('');
});
