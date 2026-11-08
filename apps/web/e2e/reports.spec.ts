import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, sql, startStorm } from './helpers';

test('reports: crew hours split on a quiet gap, export for payroll, and salt used and on hand', async ({ page }) => {
  await login(page);
  const name = `Report storm ${randomUUID().slice(0, 6)}`;
  const { runs } = await startStorm(page.request, name, ['West Lakewood']);
  const run = runs[0]!;
  const [crew] = await sql`select c.name from storm_run r join crew_member c on c.id = r.crew_id where r.id = ${run.id}`;
  // A day years back that no other test touches. 15:00 UTC is mid-morning in Cleveland all year.
  const day = new Date(Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 1400) * 86_400_000).toISOString().slice(0, 10);
  const t0 = Date.parse(`${day}T15:00:00Z`);
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const token = new URL(run.link).pathname.split('/').pop()!;
  const stop = async (i: number, from: number, to: number, services: string[], salt: { unit: string; qty: number }[] | null) => {
    const visit = randomUUID();
    const res = await page.request.post(`/api/d/${token}/actions`, {
      data: {
        actions: [
          { client_uuid: randomUUID(), at: at(from), kind: 'arrive', run_stop_id: run.stops[i]!.id, visit_client_uuid: visit, gps: null },
          { client_uuid: randomUUID(), at: at(to), kind: 'done', run_stop_id: run.stops[i]!.id, visit_client_uuid: visit, services, depth_in: 3, salt, gps: null },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
  };
  await stop(0, 0, 20, ['plow'], null);
  await stop(1, 40, 60, ['plow', 'salt'], [{ unit: 'ton', qty: 2 }, { unit: 'bag50lb', qty: 20 }]);
  // Five hours later: a second shift.
  await stop(2, 300, 310, ['salt'], [{ unit: 'application', qty: 3 }]);

  await page.goto(`/reports?from=${day}&to=${day}`);
  const summary = page.getByTestId('hours-summary');
  await expect(summary.getByRole('row', { name: new RegExp(crew!.name) })).toContainText('1.17');
  await page.getByText('Every shift').click();
  const shifts = page.getByTestId('hours-shifts');
  await expect(shifts.getByRole('row')).toHaveCount(3);
  await expect(shifts).toContainText('1.00');
  await expect(shifts).toContainText('0.17');
  await expect(shifts).toContainText('split');

  const csv = await (await page.request.get(`/api/reports/hours.csv?from=${day}&to=${day}`)).text();
  expect(csv.split('\r\n')[0]).toBe('Name,Type,Storm,Clock in,Clock out,Hours,Stops done,Note');
  expect(csv).toContain(`${crew!.name},Employee,${name}`);
  expect(csv).toMatch(/,1\.00,2,/);
  expect(csv).toMatch(/,0\.17,1,/);

  const storm = page.getByTestId('salt-storms').getByRole('row', { name: new RegExp(name) });
  await expect(storm).toContainText('2.50');
  await expect(storm).toContainText('3');

  // Stock: a count sets it, a delivery adds, and removing the delivery takes it back off.
  await page.getByTestId('salt-kind').selectOption('count');
  await page.getByTestId('salt-tons').fill('50');
  await page.getByTestId('salt-save').click();
  await expect(page.getByTestId('salt-on-hand')).toContainText('50 t');
  await page.getByTestId('salt-kind').selectOption('delivery');
  await page.getByTestId('salt-tons').fill('abc');
  await page.getByTestId('salt-save').click();
  await expect(page.getByText('Enter the tons as a number.')).toBeVisible();
  await page.getByTestId('salt-tons').fill('12.5');
  await page.getByTestId('salt-save').click();
  await expect(page.getByTestId('salt-on-hand')).toContainText('62.5 t');
  await page.getByTestId('salt-entries').getByRole('button', { name: /Remove delivery/ }).first().click();
  await expect(page.getByTestId('salt-on-hand')).toContainText('50 t');

  // A dispatcher's guard: a delivery of nothing is refused.
  const zero = await page.request.post('/api/reports/salt', { data: { kind: 'delivery', tons: 0 } });
  expect(zero.status()).toBe(422);
});
