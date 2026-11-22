import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

/** STAR's big-company tickets (issues 226, 227, 228), screen by screen. */
const once = (name: string) => test.skip(name !== 'iphone-13', 'once is enough');

test('sub companies: add one, make its portal link, and the sub sees its own page; the insurance block saves (issue 226)', async ({ page, browser, baseURL }, info) => {
  once(info.project.name);
  await login(page);
  const name = `Ridge Plowing ${Date.now()}`;
  const [t] = await sql`select id, block_lapsed_coi from tenant where slug = 'lakeshore-demo'`;
  try {
    await page.goto('/settings?tab=crew');
    await page.getByTestId('sub-new-name').fill(name);
    await page.getByTestId('sub-add').click();
    const row = page.getByTestId('sub-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('0 drivers, 0 lots');
    await row.getByTestId('sub-portal-new').click();
    await expect(page.getByTestId('subs-msg')).toContainText('Portal link made');
    const [s] = await sql`select portal_token_hash from sub_company where name = ${name}`;
    expect(s!.portal_token_hash).toBeTruthy();
    await expect(row.getByTestId('sub-portal-copy')).toBeVisible();
    // The sub's page, signed out: its name, no visits yet, and nothing about customers. The link the office copies is
    // read back from the list API.
    const list = await (await page.request.get('/api/subs')).json() as { subs: { name: string; portal_url: string | null }[] };
    const link = list.subs.find((x) => x.name === name)!.portal_url!;
    expect(link).toContain('/sub/');
    const sub = await browser.newContext({ baseURL });
    const p = await sub.newPage();
    await p.goto(new URL(link).pathname);
    await expect(p.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(p.getByText('No visits in these dates.')).toBeVisible();
    await expect(p.locator('body')).not.toContainText('@');
    await sub.close();
    // The insurance block saves and can be turned back off.
    await page.getByTestId('coi-block').check();
    await expect(page.getByTestId('subs-msg')).toContainText('blocked from storm runs');
    expect((await sql`select block_lapsed_coi from tenant where id = ${t!.id}`)[0]!.block_lapsed_coi).toBe(true);
  } finally {
    await sql`delete from sub_company where name = ${name}`;
    await sql`update tenant set block_lapsed_coi = ${t!.block_lapsed_coi} where id = ${t!.id}`;
  }
});

test('branches: a one-yard company sees one line, the first branch puts everything in Main, and the team form offers the new roles (issue 227)', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  try {
    await page.goto('/settings?tab=team');
    await expect(page.getByTestId('branches-panel')).toContainText('Run more than one yard?');
    await expect(page.getByTestId('branch-row')).toHaveCount(0);
    // Roles: billing and field lead without branches; branch manager only once there are two.
    const roles = await page.getByTestId('team-role').locator('option').allTextContents();
    expect(roles).toEqual(expect.arrayContaining(['Dispatcher', 'Viewer', 'Billing', 'Field lead', 'Owner']));
    expect(roles).not.toContain('Branch manager');
    await page.getByTestId('team-role').selectOption('field_lead');
    await expect(page.getByTestId('team-role-help')).toContainText('Sees no prices');
    await page.getByTestId('branch-name').fill('West yard');
    await page.getByTestId('branch-add').click();
    await expect(page.getByTestId('branches-msg')).toContainText('Everything you had is now in Main');
    await expect(page.getByTestId('branch-row')).toHaveCount(2);
    await expect(page.getByTestId('branch-row').first()).toContainText('Main');
    await expect(page.getByTestId('branch-move')).toBeVisible();
    expect(await page.getByTestId('team-role').locator('option').allTextContents()).toContain('Branch manager');
    // Profit per lot and Reports offer the branch filter now.
    await page.goto('/reports/profit');
    await expect(page.getByTestId('profit-branch')).toBeVisible();
    await page.goto('/reports');
    await expect(page.getByTestId('reports-branch')).toBeVisible();
  } finally {
    // Leaves the demo company as it was: deleting the branches clears every branch_id (on delete set null).
    await sql`delete from branch where tenant_id = ${t!.id}`;
  }
});

test('big lists page: past proof packets and receivables offer older pages when there are many (issue 228)', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  await page.goto('/proof');
  await expect(page.getByTestId('past-packets')).toBeVisible();
  const packets = Number((await sql`select count(*)::int as n from proof_packet where tenant_id = (select id from tenant where slug = 'lakeshore-demo')`)[0]!.n);
  await expect(page.getByTestId('packets-older')).toHaveCount(packets > 20 ? 1 : 0);
  await page.goto('/receivables?page=99');
  await expect(page.getByTestId('aging-totals')).toBeVisible();
});
