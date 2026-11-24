import { expect, test } from '@playwright/test';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/** The Nov 23 screen-by-screen pass: what changed should keep working. */
const once = (name: string) => test.skip(name !== 'iphone-13', 'once is enough');

test('storms: while one runs, the banner is its only card and Start another storm opens from the header link', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  const { id } = await startStorm(page.request, `Fold ${Date.now()}`, ['Rocky River']);
  try {
    await page.goto('/storms');
    await expect(page.getByTestId('live-storm')).toHaveCount(1);
    await expect(page.getByTestId('storm-name')).toBeHidden();
    await page.getByTestId('jump-start-storm').click();
    await expect(page.getByTestId('storm-name')).toBeVisible();
    // The board: call out, standby and salt sit together in one labeled panel.
    await page.goto(`/storms/${id}`);
    const panel = page.getByTestId('crew-and-salt');
    await expect(panel.getByTestId('standby')).toContainText('Standby drivers');
    await expect(panel.getByTestId('storm-ration')).toContainText('Normal amounts.');
  } finally {
    await closeRunningStorms();
  }
});

test('customer page: call, text and email in one tap at the top', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  const [c] = await sql`select c.id, c.phone_e164, c.email from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.phone_e164 is not null and c.email is not null and c.archived_at is null limit 1`;
  await page.goto(`/customers/${c!.id}`);
  await expect(page.getByTestId('customer-call')).toHaveAttribute('href', `tel:${c!.phone_e164}`);
  await expect(page.getByTestId('customer-details')).toContainText(/\(\d{3}\) \d{3}-\d{4}/);
  await expect(page.getByTestId('customer-text')).toHaveAttribute('href', `sms:${c!.phone_e164}`);
  await expect(page.getByTestId('customer-email')).toHaveAttribute('href', `mailto:${c!.email}`);
  // The details read first; Edit turns them into a form, and Cancel puts them back unchanged.
  await expect(page.locator('#name')).toHaveCount(0);
  await page.getByTestId('customer-edit').click();
  await expect(page.locator('#name')).toBeVisible();
  await page.getByTestId('customer-cancel').click();
  await expect(page.getByTestId('customer-details')).toBeVisible();
  // Archive sits at the end of the page, not beside Add a site.
  const add = (await page.getByTestId('add-site').boundingBox())!;
  const archive = (await page.getByTestId('archive-customer').boundingBox())!;
  expect(archive.y).toBeGreaterThan(add.y + 300);
  // Settings shows the office phone the way people write it.
  await page.goto('/settings?tab=company');
  await expect(page.getByTestId('co-phone')).toHaveValue(/^\(\d{3}\) \d{3}-\d{4}$|^$/);
});

test('renewals: Renew all asks once, then makes a draft for every lot on the list', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  await page.goto('/bids');
  const rows = page.getByTestId('renewal-row');
  const n = await rows.count();
  test.skip(n < 2, 'needs two lots to renew');
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const before = Number((await sql`select count(*)::int as n from contract where tenant_id = ${t!.id} and status = 'draft'`)[0]!.n);
  await page.getByTestId('renew-all').click();
  await page.getByRole('button', { name: `Make ${n} drafts` }).click();
  await expect(page.getByTestId('bids-note')).toContainText(`${n} drafts made`);
  await expect(rows).toHaveCount(0);
  const after = Number((await sql`select count(*)::int as n from contract where tenant_id = ${t!.id} and status = 'draft'`)[0]!.n);
  expect(after - before).toBe(n);
  // Put the demo back: the drafts this made go.
  await sql`delete from contract where tenant_id = ${t!.id} and status = 'draft' and created_at > now() - interval '5 minutes'`;
});

test('dashboard: a billed storm with bills reads Billed, not "Closed, no bills" (journey walk)', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  const [c] = await sql`select id from customer where tenant_id = ${t!.id} and archived_at is null limit 1`;
  const name = `Billed ${Date.now()}`;
  const [s] = await sql`insert into storm (tenant_id, name, started_at, closed_at, status) values (${t!.id}, ${name}, now() + interval '1 hour', now() + interval '2 hours', 'billed') returning id`;
  await sql`insert into invoice_draft (tenant_id, storm_id, customer_id, lines, subtotal_cents, flags, status) values (${t!.id}, ${s!.id}, ${c!.id}, '[]'::jsonb, 5000, '[]'::jsonb, 'approved')`;
  try {
    await page.goto('/dashboard');
    await expect(page.locator('tr', { hasText: name })).toContainText('Billed');
    await expect(page.locator('tr', { hasText: name })).not.toContainText('no bills');
  } finally {
    await sql`delete from invoice_draft where storm_id = ${s!.id}`;
    await sql`delete from storm where id = ${s!.id}`;
  }
});

test('a photo link from a text opens a page with the company, the lot and when it was cleared, not a bare image', async ({ page }, info) => {
  once(info.project.name);
  const [p] = await sql`select ph.id, ph.tenant_id, s.label from visit_photo ph join visit v on v.id = ph.visit_id join site s on s.id = v.site_id join tenant t on t.id = ph.tenant_id where t.slug = 'lakeshore-demo' order by ph.received_at desc limit 1`;
  test.skip(!p, 'needs a visit photo');
  const code = `t${Date.now().toString(36)}`;
  await sql`insert into short_link (code, tenant_id, target) values (${code}, ${p!.tenant_id}, ${`photo:${p!.id}`})`;
  try {
    await page.goto(`/s/${code}`);
    await page.waitForURL(`**/photo/${code}`);
    await expect(page.getByTestId('photo-site')).toHaveText(p!.label as string);
    await expect(page.getByTestId('photo-when')).toContainText(/Cleared|Visited/);
    await expect(page.getByTestId('photo-figure').first()).toBeVisible();
    // The image itself is still there for anyone who wants the file.
    const raw = await page.request.get(`/s/${code}?raw=1`, { maxRedirects: 0 });
    expect(raw.status()).toBe(307);
    expect(raw.headers().location).toContain('/storage/');
    // A team invite lands on sign-in with a line saying why.
    await page.goto('/login?invited=1');
    await expect(page.getByTestId('login-invited')).toBeVisible();
  } finally {
    await sql`delete from short_link where code = ${code}`;
  }
});

test('customer and driver links: quote says what is missing and what happens next, a bad short link gets a page, and a driver with no signal is told so', async ({ page, browser, baseURL }, info) => {
  once(info.project.name);
  await login(page);
  const [lot] = await sql`select s.id from site s join customer c on c.id = s.customer_id join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.archived_at is null order by s.created_at desc limit 1`;
  const q = await (await page.request.post('/api/quotes', { data: { site_id: lot!.id, season: '2027-28', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 9000 } }], send: false } })).json();
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const c = await ctx.newPage();
    await c.goto(q.url);
    await expect(c.getByTestId('quote-contact')).toContainText('Call (216) 555-0100');
    await c.getByTestId('accept').click();
    await expect(c.getByTestId('accept-error')).toContainText('Type your full name');
    await c.getByTestId('sign-name').fill('Pat Customer');
    await c.getByTestId('accept').click();
    await expect(c.getByTestId('accept-error')).toContainText('Tick the box');
    await c.getByTestId('agree').check();
    await c.getByTestId('accept').click();
    await expect(c.getByTestId('accepted-what-next')).toContainText('2027-28 season');
    await expect(c.getByTestId('accepted-what-next')).toContainText('when snow reaches 2"');
    // A short link with a typo lands on a page that says what to do.
    await c.goto('/s/notarealcode');
    await expect(c.getByTestId('link-gone')).toBeVisible();
    // A driver whose phone loses signal sees it in the badge and a line saying their work is safe.
    const { runs } = await startStorm(page.request, `Signal ${Date.now()}`, ['Rocky River']);
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('arrive')).toBeVisible();
    await ctx.setOffline(true);
    await expect(d.getByTestId('sync-badge')).toHaveText('No signal');
    await expect(d.getByTestId('no-signal')).toContainText('saved on your phone');
    await ctx.setOffline(false);
    await expect(d.getByTestId('no-signal')).toHaveCount(0);
  } finally {
    await ctx.close();
    await sql`update contract set status = 'void' where site_id = ${lot!.id} and season = '2027-28'`;
    await closeRunningStorms();
  }
});
