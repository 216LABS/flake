import { devices, expect, test } from '@playwright/test';
import { closeRunningStorms, login, sql, startStorm } from './helpers';

/**
 * Long typed text may break anywhere so it never pushes a page sideways, but a short label must not: the driver's
 * "Synced" pill once read "Synce / d" on a small phone (found in a QA walk).
 */
for (const lang of ['en', 'es'] as const) {
  test(`driver header labels stay whole on a 375 phone (${lang})`, async ({ page, browser }) => {
    await login(page);
    const { runs } = await startStorm(page.request, `Labels ${lang} ${Date.now()}`, ['Rocky River']);
    const [crew] = await sql`select c.id, c.language from crew_member c join storm_run r on r.crew_id = c.id where r.id = ${runs[0]!.id}`;
    await sql`update crew_member set language = ${lang} where id = ${crew!.id}`;
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 375, height: 667 } });
    const d = await ctx.newPage();
    await d.goto(runs[0]!.link);
    const badge = d.getByTestId('sync-badge');
    await expect(badge).toBeVisible();
    // One line: a pill of 14px text with 8px padding is about 36px tall; two lines would be over 50.
    expect((await badge.boundingBox())!.height).toBeLessThan(44);
    const call = d.getByTestId('call-office');
    if (await call.count()) {
      const words = await call.evaluate((el) => {
        const range = document.createRange();
        const text = el.firstChild!;
        const lines = new Map<number, string>();
        for (let i = 0; i < (text.textContent ?? '').length; i++) {
          range.setStart(text, i); range.setEnd(text, i + 1);
          const top = Math.round(range.getBoundingClientRect().top);
          lines.set(top, (lines.get(top) ?? '') + text.textContent![i]);
        }
        return [...lines.values()].map((l) => l.trim());
      });
      // Wrapping between words is fine; every line holds whole words.
      const all = (await call.textContent())!.split(' ');
      for (const line of words) for (const w of line.split(' ')) expect(all).toContain(w);
    }
    expect(await d.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await sql`update crew_member set language = ${crew!.language} where id = ${crew!.id}`;
    await ctx.close();
    await closeRunningStorms();
  });
}
