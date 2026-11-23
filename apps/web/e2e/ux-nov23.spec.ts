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
  await expect(page.getByTestId('customer-call')).toContainText(/\(\d{3}\) \d{3}-\d{4}/);
  await expect(page.getByTestId('customer-text')).toHaveAttribute('href', `sms:${c!.phone_e164}`);
  await expect(page.getByTestId('customer-email')).toHaveAttribute('href', `mailto:${c!.email}`);
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
