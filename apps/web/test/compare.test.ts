import { describe, expect, it } from 'vitest';
import { AS_OF, PRICES, PRODUCTS, ROWS, SOURCES } from '@/lib/compare';

describe('issue 181: the /compare grid', () => {
  it('has every product in every row, in the ticket\'s order', () => {
    expect(PRODUCTS).toEqual(['Flake', 'Jobber', 'Yeti', 'Service Autopilot', 'Plowdesk']);
    for (const r of ROWS) expect(Object.keys(r.cells).sort()).toEqual([...PRODUCTS].sort());
    for (const p of PRODUCTS) expect(PRICES[p].length).toBeGreaterThan(10);
  });

  it('keeps the cells the ticket pinned down', () => {
    const cell = (feature: string, p: (typeof PRODUCTS)[number]) => ROWS.find((r) => r.feature.startsWith(feature))!.cells[p];
    // Flake's QuickBooks is a CSV export, never "sync".
    expect(cell('QuickBooks', 'Flake').note).toBe('CSV export');
    expect(JSON.stringify(cell('QuickBooks', 'Flake'))).not.toMatch(/sync/i);
    // No competitor uses a no-install link.
    for (const p of PRODUCTS.slice(1)) expect(cell('Driver check-in with no app', p).v).toBe('no');
    expect(cell('Per-inch tier billing', 'Yeti').v).toBe('no');
    expect(cell('Per-inch tier billing', 'Jobber').v).toBe('partial');
    expect(cell('Payroll file for Gusto or ADP', 'Yeti').v).toBe('no');
    expect(cell('Customer portal', 'Service Autopilot').v).toBe('addon');
    expect(cell('Forecast and weather evidence', 'Jobber').v).toBe('unverified');
  });

  it('cites a public page for every competitor and carries the as-of footnote', () => {
    for (const s of SOURCES.filter((x) => x.product !== 'Flake')) {
      expect(s.links.length).toBeGreaterThan(0);
      for (const [, href] of s.links) expect(href).toMatch(/^https:\/\//);
    }
    expect(AS_OF).toBe('As of November 2026, based on public information. Features, plan limits, and prices change; confirm with each vendor.');
  });

  it('issue 182: Flake shows the free season, with no plan, price or fee figure', () => {
    expect(PRICES.Flake).toBe('Free for the 2026-27 season');
    const flake = JSON.stringify([PRICES.Flake, ROWS.map((r) => r.cells.Flake)]);
    expect(flake).not.toMatch(/\$|%|\bPro\b|Free plan/);
  });
});
