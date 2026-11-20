import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

const demo = sql`(select id from tenant where slug = 'lakeshore-demo')`;

/** Issues 165-170: each new office screen opens on a phone, and its main action works. */
test('receivables: record a part payment and the balance drops', async ({ page }) => {
  await login(page);
  const [d] = await sql`select id, subtotal_cents from invoice_draft where tenant_id = ${demo} and status in ('approved','sent','failed') and subtotal_cents > 200 order by created_at limit 1`;
  test.skip(!d, 'needs an open bill in the demo');
  try {
    await page.goto('/receivables');
    await expect(page.getByTestId('aging-totals')).toBeVisible();
    const row = page.getByTestId('receivable-row').first();
    await expect(row).toBeVisible();
    const before = await page.getByTestId('aging-all').textContent();
    await row.getByTestId('record-payment').click();
    await row.getByTestId('payment-amount').fill('1.00');
    await row.getByTestId('payment-ref').fill('E2E');
    await row.getByTestId('payment-save').click();
    await expect(page.getByTestId('aging-all')).not.toHaveText(before!);
    await expect(page.getByTestId('recent-payments')).toContainText('E2E');
  } finally {
    await sql`delete from payment where reference = 'E2E' and tenant_id = ${demo}`;
    await sql`update invoice_draft set status = 'approved', status_detail = null where tenant_id = ${demo} and status_detail like 'Paid in full, recorded by the office%'`;
  }
});

test('payroll and profit pages open', async ({ page }) => {
  await login(page);
  await page.goto('/reports/payroll');
  await expect(page.getByTestId('payroll-period')).toBeVisible();
  // With no ADP company code, ADP file says what's missing instead of opening a raw error page (issue 209).
  const [{ payroll }] = await sql`select payroll from tenant where id = ${demo}`;
  try {
    await sql`update tenant set payroll = coalesce(payroll, '{}'::jsonb) - 'adp_co_code' where id = ${demo}`;
    await page.reload();
    if (await page.getByTestId('payroll-table').isVisible()) {
      await expect(page.getByTestId('payroll-adp')).toHaveCount(0);
      await expect(page.getByTestId('payroll-adp-off')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('payroll-adp-help')).toContainText('ADP company code');
      await sql`update tenant set payroll = coalesce(payroll, '{}'::jsonb) || '{"adp_co_code":"E2E"}'::jsonb where id = ${demo}`;
      await page.reload();
      await expect(page.getByTestId('payroll-adp')).toBeVisible();
      await expect(page.getByTestId('payroll-adp-help')).toHaveCount(0);
    }
  } finally {
    await sql`update tenant set payroll = ${payroll === null ? null : sql.json(payroll)} where id = ${demo}`;
  }
  await page.goto('/reports/profit');
  await expect(page.getByTestId('profit-filters')).toBeVisible();
  await expect(page.locator('main')).toContainText(/Profit per lot/);
});

test('salt yards: a delivery with its cost raises on hand and sets the cost per ton', async ({ page }) => {
  await login(page);
  const note = `E2E ${randomUUID().slice(0, 6)}`;
  try {
    await page.goto('/salt');
    const card = page.getByTestId('yard-card').first();
    const before = Number(await card.getByTestId('yard-tons').getAttribute('data-tons'));
    await card.getByTestId('yard-tons-input').fill('10');
    await card.getByTestId('yard-cost').fill('800');
    await card.getByTestId('yard-note').fill(note);
    await card.getByTestId('yard-add-line').click();
    await expect(card.getByTestId('yard-tons')).toHaveText(`${Math.round((before + 10) * 100) / 100} tons`);
    await expect(card).toContainText('a ton');
  } finally {
    await sql`delete from salt_ledger where note = ${note}`;
  }
});

test('insurance and claims: add a claim on a lot, move it to pending', async ({ page }) => {
  await login(page);
  const ref = `E2E-${randomUUID().slice(0, 6)}`;
  try {
    await page.goto('/proof');
    await page.getByTestId('open-compliance').click();
    await expect(page.getByTestId('company-certs')).toBeVisible();
    await page.getByTestId('claim-at').fill('2026-11-02T07:30');
    await page.getByLabel('Claim number (optional)').fill(ref);
    await page.getByTestId('claim-add').click();
    const row = page.getByTestId('claim-row').filter({ hasText: ref });
    await expect(row).toBeVisible();
    await row.getByTestId('claim-status').selectOption('pending');
    await expect.poll(async () => (await sql`select status from claim where reference = ${ref}`)[0]?.status).toBe('pending');
    await expect(row.getByTestId('claim-make-packet')).toHaveAttribute('href', /incident=2026-11-02T07:30/);
  } finally {
    await sql`delete from claim where reference = ${ref}`;
  }
});

test('bids: add a prospect, mark it lost with a reason', async ({ page }) => {
  await login(page);
  const name = `E2E Plaza ${randomUUID().slice(0, 6)}`;
  try {
    await page.goto('/customers');
    await page.getByTestId('open-bids').click();
    await expect(page.getByTestId('renewals')).toBeVisible();
    await page.getByTestId('bid-prospect').fill(name);
    await page.getByTestId('bid-estimate').fill('4200');
    await page.getByTestId('bid-add').click();
    const row = page.getByTestId('bid-row').filter({ hasText: name });
    await expect(row).toContainText('$4,200.00');
    await row.getByTestId('bid-stage').selectOption('lost');
    await row.getByTestId('bid-lost-why').fill('Price');
    await row.getByTestId('bid-lost-save').click();
    await expect.poll(async () => (await sql`select stage, lost_reason from bid where prospect_name = ${name}`)[0]).toEqual({ stage: 'lost', lost_reason: 'Price' });
  } finally {
    await sql`delete from bid where prospect_name = ${name}`;
  }
});
