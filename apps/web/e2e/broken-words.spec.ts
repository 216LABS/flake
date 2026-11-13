import { devices, expect, test, type Page } from '@playwright/test';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/**
 * A short label (a button, a badge, a tab, a heading) never splits a word across two lines. Long typed text may, so a
 * page never scrolls sideways; a label like "Synced" breaking into "Synce / d" is a bug (issue 107), and this checks
 * every screen for it instead of relying on someone noticing.
 */
async function brokenWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shortLabels = [...document.querySelectorAll<HTMLElement>('button, a, label, h1, h2, h3, legend, [data-testid], span')]
      .filter((el) => el.offsetParent !== null && (el.innerText ?? '').trim().length > 0 && (el.innerText ?? '').trim().length <= 30 && el.children.length === 0);
    for (const el of shortLabels) {
      const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!node) continue;
      const text = node.textContent!;
      const range = document.createRange();
      let start = 0;
      for (const word of text.split(/(\s+)/)) {
        if (word.trim().length > 1) {
          const tops = new Set<number>();
          for (let i = 0; i < word.length; i++) {
            range.setStart(node, start + i);
            range.setEnd(node, start + i + 1);
            const r = range.getBoundingClientRect();
            if (r.height) tops.add(Math.round(r.top));
          }
          if (tops.size > 1) out.push(`"${word}" in "${text.trim()}"`);
        }
        start += word.length;
      }
    }
    return out;
  });
}

test('no short label on any screen breaks a word across two lines at 375 wide', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  const { id, runs } = await startStorm(page.request, `Words ${Date.now()}`, ['West Lakewood']);
  const [c] = await sql`select c.id from customer c join tenant t on t.id = c.tenant_id where t.slug = 'lakeshore-demo' and c.archived_at is null order by c.created_at limit 1`;
  const [s] = await sql`select id from site where customer_id = ${c!.id} limit 1`;
  const office = ['/dashboard', '/storms', `/storms/${id}`, '/customers', `/customers/${c!.id}`, `/sites/${s!.id}`, '/customers/new', '/routes', '/billing', '/proof', '/reports',
    '/settings', '/settings?tab=rate', '/settings?tab=crew', '/settings?tab=team', '/settings?tab=payments', '/settings?tab=sms', '/settings?tab=plan', '/settings?tab=system'];
  const found: string[] = [];
  for (const path of office) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    for (const w of await brokenWords(page)) found.push(`${path}: ${w}`);
  }
  for (const lang of ['en', 'es'] as const) {
    const [crew] = await sql`select c.id, c.language from crew_member c join storm_run r on r.crew_id = c.id where r.id = ${runs[0]!.id}`;
    await sql`update crew_member set language = ${lang} where id = ${crew!.id}`;
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 375, height: 667 } });
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    await expect(d.getByTestId('next-stop')).toBeVisible();
    for (const w of await brokenWords(d)) found.push(`driver (${lang}): ${w}`);
    await d.getByTestId('arrive').click();
    await expect(d.getByTestId('onsite')).toBeVisible();
    for (const w of await brokenWords(d)) found.push(`driver on site (${lang}): ${w}`);
    await sql`update crew_member set language = ${crew!.language} where id = ${crew!.id}`;
    await ctx.close();
  }
  const { url } = await (await page.request.get(`/api/customers/${c!.id}/portal`)).json();
  await page.goto(url);
  for (const w of await brokenWords(page)) found.push(`records page: ${w}`);
  expect(found).toEqual([]);
  await closeRunningStorms();
});
