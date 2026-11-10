import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { finishStops, login, sql, startStorm } from './helpers';

/** A brand new company, signed in through a fresh browser context. */
async function strangerContext(browser: import('@playwright/test').Browser, baseURL: string | undefined) {
  const email = `stranger-${randomUUID()}@flake.test`;
  const ctx = await browser.newContext({ baseURL });
  const res = await ctx.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(res.ok()).toBe(true);
  expect((await ctx.request.post('/api/dev/login', { data: { email } })).ok()).toBe(true);
  expect((await ctx.request.post('/api/onboarding', { data: { name: 'Stranger Plow' } })).ok()).toBe(true);
  return { ctx, email };
}

test('another company cannot reach any of our records through the office API', async ({ page, browser, baseURL }) => {
  await login(page);
  const { id: stormId, runs } = await startStorm(page.request, `Victim ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  await finishStops(page.request, run, run.stops.slice(0, 1));
  const closed = await page.request.post(`/api/storms/${stormId}/close`, { data: { force: true } });
  expect(closed.ok()).toBe(true);
  await page.request.post(`/api/storms/${stormId}/billing/draft`);
  const [draft] = await sql`select id from invoice_draft where storm_id = ${stormId} limit 1`;
  const [cust] = await sql`select c.id from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  const [st] = await sql`select s.id from site s join tenant t on t.id = s.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  const [crew] = await sql`select id from crew_member where email = 'dale@flake.test'`;
  const [route] = await sql`select r.id from route r join tenant t on t.id = r.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  const [visit] = await sql`select id from visit where storm_id = ${stormId} limit 1`;
  const [packet] = await sql`select p.id from proof_packet p join tenant t on t.id = p.tenant_id where t.slug = 'lakeshore-demo' limit 1`;
  const snapshot = async () => JSON.stringify(await sql`select
    (select status from storm where id = ${stormId}) a,
    (select crew_id from storm_run where id = ${run.id}) b,
    (select link_token_hash from storm_run where id = ${run.id}) c,
    (select storm_run_id::text || status from run_stop where id = ${run.stops[1]!.id}) d,
    (select status from invoice_draft where id = ${draft!.id}) e,
    (select name from customer where id = ${cust!.id}) f,
    (select label || active::text from site where id = ${st!.id}) g,
    (select name || active::text from crew_member where id = ${crew!.id}) h,
    (select count(*) from route_stop where route_id = ${route!.id}) i,
    (select count(*) from visit_correction where visit_id = ${visit!.id}) j,
    (select count(*) from message_log where related->>'storm_id' = ${stormId}) k`);
  const before = await snapshot();

  const { ctx } = await strangerContext(browser, baseURL);
  const r: APIRequestContext = ctx.request;
  const secretNames = ['Lakeshore', 'Madison Ave', 'Rocky River', 'Dale Example'];
  const attacks: [string, () => Promise<import('@playwright/test').APIResponse>][] = [
    ['read customer', () => r.get(`/api/customers/${cust!.id}`)],
    ['read site', () => r.get(`/api/sites/${st!.id}`)],
    ['read crew', () => r.get(`/api/crew/${crew!.id}`)],
    ['read route', () => r.get(`/api/routes/${route!.id}`)],
    ['read storm', () => r.get(`/api/storms/${stormId}/live`)],
    ['edit customer', () => r.patch(`/api/customers/${cust!.id}`, { data: { name: 'Hacked' } })],
    ['edit site', () => r.patch(`/api/sites/${st!.id}`, { data: { label: 'Hacked' } })],
    ['retire site', () => r.delete(`/api/sites/${st!.id}`)],
    ['edit crew', () => r.patch(`/api/crew/${crew!.id}`, { data: { name: 'Hacked' } })],
    ['re-invite crew', () => r.post(`/api/crew/${crew!.id}/invite`)],
    ['wipe route', () => r.patch(`/api/routes/${route!.id}`, { data: { site_ids: [] } })],
    ['publish', () => r.post(`/api/storms/${stormId}/publish`)],
    ['close', () => r.post(`/api/storms/${stormId}/close`, { data: { force: true } })],
    ['add pass', () => r.post(`/api/storms/${stormId}/pass`)],
    ['notify', () => r.post(`/api/storms/${stormId}/notify`, { data: { siteIds: [st!.id], template: 'late', time: 'now' } })],
    ['move stop', () => r.patch(`/api/run-stops/${run.stops[1]!.id}`, { data: { status: 'skipped' } })],
    ['swap driver', () => r.patch(`/api/runs/${run.id}`, { data: { crew_id: crew!.id } })],
    ['rotate link', () => r.post(`/api/runs/${run.id}/revoke`)],
    ['draft', () => r.post(`/api/storms/${stormId}/billing/draft`)],
    ['fix: waive', () => r.post('/api/billing/fix', { data: { action: 'waive', storm_id: stormId, flag_key: 'x' } })],
    ['fix: replow', () => r.post('/api/billing/fix', { data: { action: 'replow', storm_id: stormId, visit_id: visit!.id } })],
    ['retry', () => r.post('/api/billing/retry', { data: { draftId: draft!.id } })],
    ['proof', () => r.post('/api/proof', { data: { siteId: st!.id, from: '2025-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' } })],
    ['quote', () => r.post('/api/quotes', { data: { site_id: st!.id, season: 'x', services: [{ service: 'plow', pricing: { type: 'per_push', amount_cents: 1 } }] } })],
    ['pin', () => r.post('/api/pins', { data: { site_id: st!.id, kind: 'stake' } })],
    ['site under our customer', () => r.post('/api/sites', { data: { customer_id: cust!.id, label: 'x', address: 'x', lat: 1, lon: 1 } })],
  ];
  for (const [name, attack] of attacks) {
    const res = await attack();
    expect(res.status(), `${name}: ${await res.text()}`).toBeGreaterThanOrEqual(400);
    expect(res.status(), name).toBeLessThan(500);
    for (const s of secretNames) expect(await res.text(), name).not.toContain(s);
  }

  // These answer 200 by design, but must do nothing and show nothing.
  const quiet = await Promise.all([
    r.post('/api/billing/approve', { data: { draftIds: [draft!.id] } }),
    r.post(`/api/storms/${stormId}/callout`, { data: { time: 'now' } }),
    r.get(`/api/billing/export.csv?storm=${stormId}`),
    r.get(`/api/proof/${packet!.id}`),
    r.get('/api/customers'),
    r.get('/api/settings/export?table=customer'),
  ]);
  for (const res of quiet) {
    const text = await res.text();
    expect(res.status()).toBeLessThan(500);
    for (const s of secretNames) expect(text, res.url()).not.toContain(s);
    expect(text).not.toContain('signedUrl');
  }
  expect(await (await r.post('/api/billing/approve', { data: { draftIds: [draft!.id] } })).json()).toEqual({ approved: 0 });

  // Their pages don't show it either.
  const p = await ctx.newPage();
  for (const path of [`/storms/${stormId}`, `/customers/${cust!.id}`, `/sites/${st!.id}`, `/billing?storm=${stormId}`]) {
    await p.goto(path);
    for (const s of secretNames) expect(await p.locator('body').textContent(), path).not.toContain(s);
  }
  await ctx.close();
  expect(await snapshot()).toBe(before);
});

test('roles: dispatchers run storms but not settings, viewers only look, nobody signed out gets in', async ({ browser, baseURL, page }) => {
  const asUser = async (email: string) => {
    const ctx = await browser.newContext({ baseURL });
    expect((await ctx.request.post('/api/dev/login', { data: { email } })).ok()).toBe(true);
    return ctx;
  };
  const dispatcher = await asUser('dispatch@flake.test');
  expect((await dispatcher.request.post('/api/customers', { data: { name: `By dispatcher ${randomUUID()}`, kind: 'residential' } })).status()).toBe(201);
  expect((await dispatcher.request.put('/api/settings/rate-card', { data: {} })).status()).toBe(403);
  expect((await dispatcher.request.patch('/api/settings', { data: { name: 'Nope' } })).status()).toBe(403);
  expect((await dispatcher.request.post('/api/settings/stripe')).status()).toBe(403);
  expect((await dispatcher.request.post('/api/settings/team', { data: { email: 'x@flake.test', role: 'owner' } })).status()).toBe(403);
  expect((await dispatcher.request.get('/api/settings/export?table=customer')).status()).toBe(403);
  // A dispatcher is offered the tabs they can use, and owner-only pages say so.
  const dispatcherPage = await dispatcher.newPage();
  await dispatcherPage.goto('/settings');
  await expect(dispatcherPage.getByTestId('tab-crew')).toBeVisible();
  await expect(dispatcherPage.getByTestId('crew-invite')).toBeVisible();
  await expect(dispatcherPage.getByTestId('tab-rate')).toHaveCount(0);
  await expect(dispatcherPage.getByTestId('tab-payments')).toHaveCount(0);
  await dispatcherPage.goto('/settings?tab=payments');
  await expect(dispatcherPage.getByTestId('owner-only')).toBeVisible();
  await dispatcher.close();

  // The owner adds a viewer who already has a Flake login but no company.
  await login(page);
  const email = `viewer-${randomUUID()}@flake.test`;
  const signup = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password: 'flake-demo-only' } });
  expect(signup.ok()).toBe(true);
  await page.goto('/settings?tab=team');
  await page.getByTestId('team-email').fill(email);
  await page.getByTestId('team-role').selectOption('viewer');
  await page.getByTestId('team-add').click();
  await expect(page.getByTestId('team-row').filter({ hasText: email })).toBeVisible();
  expect((await page.request.post('/api/settings/team', { data: { email, role: 'viewer' } })).status()).toBe(409);

  const viewer = await asUser(email);
  expect((await viewer.request.get('/api/customers')).status()).toBe(200);
  expect((await viewer.request.post('/api/customers', { data: { name: 'No', kind: 'residential' } })).status()).toBe(403);
  expect((await viewer.request.post('/api/storms', { data: { name: 'No', routeIds: [] } })).status()).toBe(403);
  // A viewer sees the board but isn't offered changes, and never gets a driver's link, which would let them act as the driver.
  const { id: stormId } = await startStorm(page.request, `Roles ${Date.now()}`, ['West Lakewood']);
  const ownerLive = await (await page.request.get(`/api/storms/${stormId}/live`)).json();
  expect(ownerLive.runs[0].link).toContain('/d/');
  const viewerLive = await (await viewer.request.get(`/api/storms/${stormId}/live`)).json();
  expect(viewerLive.runs[0].stops.length).toBeGreaterThan(0);
  expect(JSON.stringify(viewerLive)).not.toContain('/d/');
  const viewerPage = await viewer.newPage();
  await viewerPage.goto(`/storms/${stormId}`);
  await expect(viewerPage.getByTestId('view-only')).toBeVisible();
  await expect(viewerPage.getByTestId('stop-card').first()).toBeVisible();
  await expect(viewerPage.getByTestId('close-storm')).toHaveCount(0);
  await expect(viewerPage.getByTestId('show-link')).toHaveCount(0);
  await expect(viewerPage.getByTestId('assign-driver')).toHaveCount(0);
  await viewerPage.goto('/storms');
  await expect(viewerPage.getByTestId('create-storm')).toBeDisabled();
  await viewerPage.goto('/customers');
  await expect(viewerPage.getByTestId('new-customer')).toHaveCount(0);
  await viewerPage.goto('/customers/new');
  await viewerPage.waitForURL('**/customers');
  await viewerPage.goto('/settings?tab=team');
  await expect(viewerPage.getByTestId('owner-only')).toBeVisible();
  await viewer.close();

  // A person in a company can't be added to a second one, and new office staff get a sign-in email.
  expect((await page.request.post('/api/settings/team', { data: { email: 'someone-new@flake.test'.replace('someone', randomUUID()), role: 'dispatcher' } })).status()).toBe(201);

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('team-row').filter({ hasText: email }).getByTestId('team-remove').click();
  await expect(page.getByTestId('team-row').filter({ hasText: email })).toHaveCount(0);

  await page.getByTestId('sign-out').click();
  await page.waitForURL('**/login');
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
});

test('texts: natural replies count, free-text reaches the office, and the board says who cannot be reached', async ({ page }) => {
  await login(page);
  const phone = `+1216555${String(1000 + Math.floor(Math.random() * 8999))}`;
  const crew = await (await page.request.post('/api/crew', { data: { name: `Reach ${Date.now()}`, kind: 'employee', phone_e164: phone } })).json();
  const { id: stormId, runs } = await startStorm(page.request, `Reach ${Date.now()}`, ['West Lakewood']);
  const run = runs[0]!;
  expect((await page.request.patch(`/api/runs/${run.id}`, { data: { crew_id: crew.id } })).ok()).toBe(true);

  // Never agreed to texts and has no email, so nothing can reach them. The office has to know.
  await page.goto(`/storms/${stormId}`);
  const column = page.getByTestId('run-column').filter({ hasText: crew.name });
  await expect(column.getByTestId('no-reach')).toBeVisible();

  // After agreeing, the warning goes.
  const invite = await page.request.post(`/api/crew/${crew.id}/invite`);
  const token = new URL((await invite.json()).invite_url).pathname.split('/').pop();
  expect((await page.request.post(`/api/join/${token}`, { data: { consent: true } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('stop-card').first()).toBeVisible();
  await expect(column.getByTestId('no-reach')).toHaveCount(0);

  const send = async (body: string) => (await page.request.post('/api/dev/sms', { data: { from: phone, body } })).json();
  const reply = async () => (await (await page.request.get(`/api/storms/${stormId}/live`)).json()).runs.find((r: { id: string }) => r.id === run.id).crew.callout_reply;
  expect((await send('yes!')).kind).toBe('yes');
  expect(await reply()).toBe('YES');
  expect((await send(' No. ')).kind).toBe('no');
  expect(await reply()).toBe('NO');

  // Anything else is a person talking, and someone should read it.
  const words = `running late ${Date.now()}`;
  expect((await send(words)).kind).toBe('other');
  await expect.poll(async () => (await sql`select count(*)::int as n from message_log where template = 'owner_alert' and body like ${`%${words}%`}`)[0]!.n, { timeout: 30000 }).toBeGreaterThan(0);

  // After STOP the warning comes back.
  await send('STOP');
  await page.reload();
  await expect(page.getByTestId('stop-card').first()).toBeVisible();
  await expect(column.getByTestId('no-reach')).toBeVisible();
});

test('a multi-site customer: add a second site, fix their details, send a renewal quote, retire a site', async ({ page, browser }) => {
  await login(page);
  const name = `Multi ${Date.now()}`;
  const made = await page.request.post('/api/customers', { data: { name, kind: 'commercial', email: 'multi@flake.test' } });
  const customer = await made.json();
  const before = (await sql`select count(*)::int n from customer where name = ${name}`)[0]!.n;

  await page.goto(`/customers/${customer.id}`);
  await page.getByTestId('add-site').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Add a site for ${name}`);
  await page.getByTestId('address').fill('100 Second Lot Rd, Lakewood, OH');
  await page.getByTestId('find').click();
  await expect(page.getByTestId('sqft')).toContainText('sq ft');
  for (let i = 0; i < 3; i++) await page.getByTestId('next').click();
  await page.getByTestId('next').click();
  await page.getByTestId('send-quote').click();
  await expect(page.getByTestId('quote-sent')).toBeVisible();
  expect((await sql`select count(*)::int n from customer where name = ${name}`)[0]!.n).toBe(before);
  expect((await sql`select count(*)::int n from site where customer_id = ${customer.id}`)[0]!.n).toBe(1);

  // Fix their details. A phone typed the way people type it is accepted, and a bad one says why.
  await page.goto(`/customers/${customer.id}`);
  await page.getByLabel('Mobile').fill('12');
  await page.getByTestId('customer-save').click();
  await expect(page.getByTestId('customer-msg')).toContainText('phone');
  await page.getByLabel('Mobile').fill('216-555-0177');
  await page.getByLabel('Billing').selectOption('invoice_net30');
  await page.getByTestId('customer-save').click();
  await expect(page.getByTestId('customer-msg')).toHaveText('Saved');
  const [saved] = await sql`select phone_e164, billing_mode from customer where id = ${customer.id}`;
  expect(saved).toMatchObject({ phone_e164: '+12165550177', billing_mode: 'invoice_net30' });

  // A renewal at a new price. Once accepted, the newest contract is the live one.
  await page.getByRole('link', { name: '100 Second Lot Rd', exact: false }).first().click();
  await page.waitForURL(/\/sites\//);
  const siteId = page.url().split('/').pop()!;
  await page.getByTestId('q-price').fill('222');
  await page.getByTestId('q-send').click();
  const url = await page.getByTestId('q-url').inputValue();
  const fresh = await browser.newContext();
  const q = await fresh.newPage();
  await q.goto(url);
  await expect(q.getByTestId('scope-line').first()).toContainText('$222.00 per push');
  await q.getByTestId('sign-name').fill('Pat Renewal');
  await q.getByTestId('agree').check();
  await q.getByTestId('accept').click();
  await expect(q.getByTestId('accepted')).toBeVisible();
  await fresh.close();

  // Retire it: gone from new work, still on file.
  await page.reload();
  await page.getByTestId('retire').click();
  await page.getByTestId('retire-confirm').click();
  await page.waitForURL(`**/customers/${customer.id}`);
  expect((await sql`select active from site where id = ${siteId}`)[0]!.active).toBe(false);
  await page.goto(`/sites/${siteId}`);
  await expect(page.getByTestId('site-retired')).toBeVisible();
});

test('crew: edit keeps their settings, and a lost invite gets a new link that works', async ({ page, browser }) => {
  await login(page);
  const name = `Crew ${Date.now()}`;
  const made = await (await page.request.post('/api/crew', { data: { name, kind: 'employee', phone_e164: '216-555-0166' } })).json();
  expect(made.phone_e164).toBe('+12165550166');
  await page.goto('/settings?tab=crew');
  const row = page.getByTestId('crew-row').filter({ hasText: name });
  await row.getByTestId('crew-edit').click();
  await page.getByTestId('crew-lang').selectOption('es');
  await page.getByTestId('crew-save').click();
  await expect(row).toContainText('Español');
  await row.getByTestId('crew-reinvite').click();
  const link = await page.getByTestId('invite-url').inputValue();
  const fresh = await browser.newContext();
  const old = await fresh.newPage();
  expect((await old.goto(made.invite_url))!.status()).toBe(404);
  await old.goto(link);
  await old.getByTestId('join').click();
  await expect(old.getByTestId('joined')).toBeVisible();
  await fresh.close();
});

test('the board clears a resolved problem, and a skipped stop can be reopened', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Clear ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  const token = new URL(run.link).pathname.split('/').pop()!;
  await page.request.post(`/api/d/${token}/actions`, { data: { actions: [{ client_uuid: randomUUID(), at: new Date().toISOString(), kind: 'problem', run_stop_id: run.stops[0]!.id, problem: 'blocked', note: 'Gate locked' }] } });
  await page.goto(`/storms/${id}`);
  await expect(page.getByTestId('alerts-rail')).toContainText('Gate locked');
  await page.getByTestId('resolve-problem').click();
  await expect(page.getByText('Gate locked')).toHaveCount(0);

  const card = page.getByTestId('stop-card').filter({ hasText: run.stops[1]!.label });
  await card.getByTestId('skip-toggle').click();
  await page.getByTestId('confirm-yes').click();
  await expect(card).toHaveAttribute('data-status', 'skipped');
  await card.getByTestId('skip-toggle').click();
  await expect(card).toHaveAttribute('data-status', 'open');
});

test('a storm with nothing on it explains itself instead of getting stuck', async ({ page }) => {
  await login(page);
  const res = await page.request.post('/api/storms', { data: { name: 'Empty', routeIds: [] } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toContain('nothing to plow');
});

test('a hung request on bad signal does not stall the phone, and a failed save says so', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Hang ${Date.now()}`, ['Rocky River']);
  await page.goto(runs[0]!.link);
  await expect(page.getByTestId('next-stop')).toBeVisible();
  // The first send never answers at all.
  let hung = 0;
  await page.route('**/actions', async (route) => {
    if (hung++ === 0) return; // Never fulfilled.
    await route.continue();
  });
  await page.getByTestId('arrive').click();
  await expect(page.getByTestId('onsite')).toBeVisible();
  // The hung send times out at 20 s, and the next try goes through.
  await expect.poll(async () => (await sql`select count(*)::int n from visit where storm_id = ${id}`)[0]!.n, { timeout: 60000 }).toBe(1);
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'synced', { timeout: 30000 });
  expect(hung).toBeGreaterThan(1);

  // The phone refuses the write. The screen must not pretend it worked.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.getByTestId('depth-3').click();
  await expect(page.getByRole('status')).toContainText('Could not save on this phone');
});

test('a visit that syncs after billing is named on the billing page', async ({ page }) => {
  await login(page);
  const { id, runs } = await startStorm(page.request, `Late ${Date.now()}`, ['Rocky River']);
  const run = runs[0]!;
  await finishStops(page.request, run, run.stops.slice(0, 2));
  await page.request.post(`/api/storms/${id}/close`, { data: { force: true } });
  await page.request.post(`/api/storms/${id}/billing/draft`);
  await page.goto(`/billing?storm=${id}`);
  await expect(page.getByTestId('missed-visits')).toHaveCount(0);
  await finishStops(page.request, run, [run.stops.find((s) => !s.label.includes('HOA') && s.id !== run.stops[0]!.id && s.id !== run.stops[1]!.id)!]);
  await page.reload();
  await expect(page.getByTestId('missed-visits')).toContainText('synced after these drafts');
});
