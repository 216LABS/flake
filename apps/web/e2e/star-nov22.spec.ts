import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeRunningStorms, login, sql, startStorm, openQuoteForm } from './helpers';

/** STAR's Nov 22 tickets (issues 231-239), screen by screen. */
const once = (name: string) => test.skip(name !== 'iphone-13', 'once is enough');

test('no-shows and long shifts: driver status, standby drivers, the offer button and the settings (issues 234, 235)', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  const { id } = await startStorm(page.request, `Standby ${Date.now()}`, ['West Lakewood']);
  try {
    await page.goto(`/storms/${id}`);
    await expect(page.getByTestId('driver-status').first()).toHaveAttribute('data-status', /not_opened|no_reply|opened|confirmed|declined/);
    await page.getByTestId('standby-edit').click();
    await page.getByTestId('standby-pick').last().check();
    await page.getByTestId('standby-save').click();
    await expect(page.getByTestId('standby-names')).not.toHaveText('nobody yet');
    const offer = page.getByTestId('offer-standby').first();
    if (await offer.count()) {
      await offer.click();
      await expect(page.getByTestId('callout-sent')).toContainText(/Offered .* standby driver/);
    }
    await page.goto('/settings?tab=alerts');
    await page.getByTestId('noshow-minutes').fill('45');
    await page.getByTestId('noshow-save').click();
    await expect(page.getByTestId('noshow-msg')).toHaveText('Saved');
    await page.getByTestId('fatigue-warn').fill('12');
    await page.getByTestId('fatigue-save').click();
    await expect(page.getByTestId('fatigue-msg')).toHaveText('Saved');
  } finally {
    const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
    await sql`delete from app_setting where key in (${`noshow_minutes:${t!.id}`}, ${`fatigue:${t!.id}`})`;
    await closeRunningStorms();
  }
});

test('salt: a surcharge on new bills, rationing for one storm, a lot\'s priority areas, and the driver\'s note (issue 232)', async ({ page, browser, baseURL }, info) => {
  once(info.project.name);
  await login(page);
  const [t] = await sql`select id from tenant where slug = 'lakeshore-demo'`;
  try {
    await page.goto('/salt');
    await page.getByTestId('surcharge-amount').fill('40');
    await page.getByTestId('surcharge-per').selectOption('ton');
    await page.getByTestId('surcharge-save').click();
    await expect(page.getByTestId('surcharge-now')).toContainText('$40.00 per ton');
    const [salted] = await sql`select s.id, s.label from contract c join site s on s.id = c.site_id join route_stop rs on rs.site_id = s.id join route r on r.id = rs.route_id where r.name = 'West Lakewood' and c.services::text like '%salt%' and c.status = 'accepted' limit 1`;
    await page.goto(`/sites/${salted!.id}`);
    await page.getByTestId('ration-area-entrances').check();
    await expect(page.getByTestId('ration-areas')).toContainText('Saved');
    const { id, runs } = await startStorm(page.request, `Ration ${Date.now()}`, ['West Lakewood']);
    await page.goto(`/storms/${id}`);
    await page.getByTestId('storm-ration-toggle').click();
    await expect(page.getByTestId('storm-ration')).toContainText('Rationed this storm');
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    if (!((await d.getByTestId('stop-label').textContent()) ?? '').includes(salted!.label as string)) await d.getByTestId('other-stop').filter({ hasText: salted!.label as string }).first().click();
    await d.getByTestId('arrive').click();
    await expect(d.getByTestId('ration-note')).toContainText('Ration salt: entrances only');
    await ctx.close();
  } finally {
    await sql`delete from app_setting where key like ${`salt_surcharge:${t!.id}`} or key like ${`ration:${t!.id}%`} or key like 'ration_areas:%'`;
    await closeRunningStorms();
  }
});

test('contract terms: a season minimum on a quote reads in plain words, and Reports tracks it (issue 233)', async ({ page, browser, baseURL }, info) => {
  once(info.project.name);
  await login(page);
  const tag = randomUUID().slice(0, 6);
  const c = await (await page.request.post('/api/customers', { data: { name: `Floor ${tag}`, kind: 'commercial', billing_mode: 'manual' } })).json();
  const s = await (await page.request.post('/api/sites', { data: { customer_id: c.id, label: `Floor lot ${tag}`, address: '12 Floor St, Lakewood, OH', lat: 41.48, lon: -81.8 } })).json();
  await page.goto(`/sites/${s.id}`);
  await openQuoteForm(page);
  await page.getByTestId('q-price').fill('70');
  await page.getByTestId('q-season-min').fill('900');
  await page.getByTestId('q-link-only').click();
  const url = await page.getByTestId('q-url').inputValue();
  const g = await (await browser.newContext({ baseURL })).newPage();
  await g.goto(url);
  await expect(g.getByTestId('scope-line').first()).toContainText('season minimum of $900.00');
  await g.getByTestId('sign-name').fill('Floor Owner');
  await g.getByTestId('agree').check();
  await g.getByTestId('accept').click();
  await expect(g.getByTestId('accepted')).toBeVisible();
  await page.goto('/reports');
  const row = page.getByTestId('season-term-row').filter({ hasText: `Floor lot ${tag}` });
  await expect(row).toContainText('$900.00');
  await expect(row).toContainText('short so far');
  await expect(row.getByTestId('trueup-draft')).toBeVisible();
  await page.goto(`/sites/${s.id}`);
  await expect(page.getByTestId('site-season-terms')).toContainText('of the $900.00 minimum');
});

test('a Jobber export imports as it is, and winter bills download for a date range (issue 239)', async ({ page }, info) => {
  once(info.project.name);
  await login(page);
  await page.goto('/customers/import');
  await page.getByTestId('csv-text').fill(readFileSync(resolve('test/fixtures/jobber-clients.csv'), 'utf8'));
  await expect(page.getByTestId('csv-source')).toContainText('Jobber export');
  await expect(page.getByTestId('csv-summary')).toContainText('2 rows, 2 ready');
  await expect(page.getByTestId('csv-row').first()).toContainText('14701 Detroit Ave Unit A, Lakewood, OH 44107');
  await page.goto('/settings?tab=data');
  await page.getByTestId('books-from').fill('2025-11-01');
  await page.getByTestId('books-to').fill('2026-04-30');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('books-download').click()]);
  expect(file.suggestedFilename()).toBe('flake-qbo-2025-11-01-to-2026-04-30.csv');
  await page.goto('/compare');
  await expect(page.getByTestId('with-jobber')).toContainText('Use Flake with Jobber');
});

test('the free templates make PDFs and spreadsheets with no account, and the trust pages are public (issues 237, 231)', async ({ browser, baseURL }, info) => {
  once(info.project.name);
  const p = await (await browser.newContext({ baseURL, acceptDownloads: true })).newPage();
  await p.goto('/tools/snow-removal-invoice-template');
  await p.getByTestId('tpl-company').fill('North Coast Snow');
  await p.getByTestId('tpl-customer').fill('Harbor HOA');
  await expect(p.getByTestId('tpl-total')).toHaveText('Total $202.00');
  const [inv] = await Promise.all([p.waitForEvent('download'), p.getByTestId('tpl-pdf').click()]);
  expect(inv.suggestedFilename()).toBe('snow-removal-invoice.pdf');
  const [invCsv] = await Promise.all([p.waitForEvent('download'), p.getByTestId('tpl-csv').click()]);
  expect(invCsv.suggestedFilename()).toBe('snow-removal-invoice.csv');
  await expect(p.getByTestId('tool-cta')).toContainText('free for the 2026-27 season');

  await p.goto('/tools/snow-plow-log-sheet');
  const [log] = await Promise.all([p.waitForEvent('download'), p.getByTestId('tpl-pdf').click()]);
  expect(log.suggestedFilename()).toBe('snow-plow-log-sheet.pdf');

  await p.goto('/tools/snow-removal-estimate-template');
  await p.getByTestId('tpl-company').fill('North Coast Snow');
  await p.getByTestId('tpl-customer').fill('Pine Church');
  await p.getByTestId('tpl-sqft').fill('20000');
  await p.getByTestId('tpl-price').click();
  await expect(p.getByTestId('tpl-suggested')).toContainText('per push');
  const [est] = await Promise.all([p.waitForEvent('download'), p.getByTestId('tpl-pdf').click()]);
  expect(est.suggestedFilename()).toBe('snow-removal-estimate.pdf');

  await p.goto('/status');
  await expect(p.getByTestId('status-part')).toHaveCount(4);
  await expect(p.getByTestId('status-part').first()).toHaveAttribute('data-state', 'up');
  await p.goto('/security');
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Security at Flake');
  await p.goto('/legal/data-retention');
  await expect(p.locator('main, section').first()).toContainText('7 years');
});
