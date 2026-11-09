import { describe, expect, it } from 'vitest';
import { distanceMeters, distanceToPolygonMeters, gpsMatches } from '../src/geo';
import { classifyInbound, inInvoiceHours, renderTemplate } from '../src/messages';
import { csvText, qboCsv } from '../src/qbo';
import { suggestPrice } from '../src/quote';
import { subPayStatement } from '../src/subpay';
import { isLate, localHm, nextInvoiceWindow, zonedDayStart } from '../src/time';
import { t } from '../src/i18n';

describe('geo', () => {
  it('measures distance', () => {
    expect(distanceMeters(41.48, -81.8, 41.481, -81.8)).toBeCloseTo(111.2, 0);
  });
  it('polygon distance: 0 inside, edge distance outside, MultiPolygon and degenerate edges', () => {
    const p = { type: 'Polygon' as const, coordinates: [[[-81.8, 41.48], [-81.799, 41.48], [-81.799, 41.481], [-81.8, 41.48]]] };
    expect(distanceToPolygonMeters(41.4802, -81.7992, p)).toBe(0);
    expect(distanceToPolygonMeters(41.479, -81.7995, p)).toBeGreaterThan(100);
    expect(distanceToPolygonMeters(41.479, -81.7995, { type: 'MultiPolygon', coordinates: [p.coordinates] })).toBeGreaterThan(100);
    expect(distanceToPolygonMeters(41.481, -81.8, { type: 'Polygon', coordinates: [[[-81.8, 41.48], [-81.8, 41.48], [-81.8, 41.48], [-81.8, 41.48]]] })).toBeGreaterThan(100);
  });
  it('gpsMatches', () => {
    expect(gpsMatches(null, -81.8, { lat: 41.48, lon: -81.8 })).toBe(false);
    expect(gpsMatches(41.48, null, { lat: 41.48, lon: -81.8 })).toBe(false);
    expect(gpsMatches(41.481, -81.8, { lat: 41.48, lon: -81.8 })).toBe(true);
  });
});

describe('sms templates', () => {
  it('renders and keeps every template at 2 segments or fewer', () => {
    const vars = { company: 'Lakeshore Plow Co.', route: 'West Lakewood', n: 14, link: 'https://flake.216labs.dev/s/abc123', time: '5:10 AM', site: 'Madison Ave Retail Lot', storm: 'Dec 12 Storm', amount: '425.00', phone: '216-555-0100', headline: 'Lakewood: 2.4" forecast by 5 AM, 18 sites at trigger.' };
    for (const k of ['crew_link', 'call_out', 'on_the_way', 'done', 'late', 'invoice', 'help', 'route_changed', 'quote', 'owner_alert', 'crew_invite'] as const) {
      expect(renderTemplate(k, vars).length, k).toBeLessThanOrEqual(306);
    }
    expect(renderTemplate('on_the_way', vars)).toBe('Lakeshore Plow Co.: Your plow is on the way to Madison Ave Retail Lot.');
  });
  it('throws on a missing variable rather than sending a broken text', () => {
    expect(() => renderTemplate('on_the_way', { company: 'x' })).toThrow();
  });
  it('classifies inbound words', () => {
    expect(classifyInbound(' stop ', false)).toBe('stop');
    expect(classifyInbound('Stop.', false)).toBe('stop');
    expect(classifyInbound(' No. ', false)).toBe('no');
    expect(classifyInbound('yes!', false)).toBe('yes');
    expect(classifyInbound('Yep', false)).toBe('yes');
    expect(classifyInbound('no problem', false)).toBe('other');
    expect(classifyInbound('running late sorry', false)).toBe('other');
    expect(classifyInbound('HELP', false)).toBe('help');
    expect(classifyInbound('YES', true)).toBe('start');
    expect(classifyInbound('START', false)).toBe('start');
    expect(classifyInbound('yes', false)).toBe('yes');
    expect(classifyInbound('n', false)).toBe('no');
    expect(classifyInbound('hello', false)).toBe('other');
  });
  it('invoice hours are 8 AM to 8 PM', () => {
    expect(inInvoiceHours('07:59')).toBe(false);
    expect(inInvoiceHours('08:00')).toBe(true);
    expect(inInvoiceHours('20:00')).toBe(false);
  });
});

describe('qbo csv', () => {
  it('escapes quotes and neutralizes formulas', () => {
    expect(csvText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvText('a,"b"')).toBe('"a,""b"""');
    expect(csvText('plain')).toBe('plain');
  });
  it('emits the header and money', () => {
    const csv = qboCsv([{ invoiceNo: '1', customer: 'A', invoiceDate: '12/12/2025', dueDate: '01/11/2026', terms: 'Net 30', memo: 'm', item: 'Plow', description: 'd', quantity: 1, rateCents: 6500, amountCents: 6500 }]);
    expect(csv.split('\r\n')[0]).toContain('InvoiceNo');
    expect(csv).toContain('65.00,65.00');
  });
});

describe('quote', () => {
  it('respects the minimum, rounds to $5 and builds tiers', () => {
    expect(suggestPrice({ sqft: 500 }).per_push_cents).toBe(4500);
    const big = suggestPrice({ sqft: 40000, walks_lf: 100 });
    expect(big.per_push_cents).toBe(25500);
    expect(big.tiers.at(-1)!.amount_cents).toBe(51000);
    expect(big.seasonal_cents).toBe(510000);
  });
});

describe('sub pay', () => {
  it('sums per-visit, hourly and bag pay for completed visits only', () => {
    const out = subPayStatement({ per_visit_cents: 1000, hourly_cents: 4000, per_bag_cents: 200 }, [
      { id: 'a', site_label: 'A', arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:30:00Z', salt: [{ unit: 'bag50lb', qty: 2 }, { unit: 'ton', qty: 1 }] },
      { id: 'b', site_label: 'B', arrived_at: '2025-12-12T10:00:00Z', departed_at: null, salt: null },
    ]);
    expect(out.lines).toHaveLength(1);
    expect(out.total_cents).toBe(1000 + 2000 + 400);
  });
  it('treats a missing rate card as zero', () => {
    expect(subPayStatement(null, [{ id: 'a', site_label: 'A', arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:30:00Z', salt: null }]).total_cents).toBe(0);
  });
});

describe('local days', () => {
  const tz = 'America/New_York';
  it('finds local midnight across standard and daylight time', () => {
    expect(zonedDayStart('2026-01-15', tz).toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(zonedDayStart('2026-07-15', tz).toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });
  it('holds invoice texts until 8 AM local', () => {
    const noon = new Date('2026-01-15T17:00:00Z');
    expect(nextInvoiceWindow(noon, tz)).toBe(noon);
    expect(localHm(nextInvoiceWindow(new Date('2026-01-15T08:00:00Z'), tz), tz)).toEqual({ hm: '08:00', date: '2026-01-15' });
    expect(localHm(nextInvoiceWindow(new Date('2026-01-16T03:00:00Z'), tz), tz)).toEqual({ hm: '08:00', date: '2026-01-16' });
  });
});

describe('isLate', () => {
  const tz = 'America/New_York';
  const started = Date.parse('2025-12-12T08:00:00Z'); // 3 AM local
  it('is late past open_by on the storm day', () => {
    expect(isLate({ open_by: '06:00' }, started, Date.parse('2025-12-12T12:00:00Z'), tz)).toBe(true);
    expect(isLate({ open_by: '06:00' }, started, Date.parse('2025-12-12T10:00:00Z'), tz)).toBe(false);
  });
  it('is not late with no window, on an excluded day, or when the storm began after the deadline', () => {
    expect(isLate(null, started, Date.parse('2025-12-12T12:00:00Z'), tz)).toBe(false);
    expect(isLate({ open_by: '06:00', days: ['sat'] }, started, Date.parse('2025-12-12T12:00:00Z'), tz)).toBe(false);
    expect(isLate({ open_by: '06:00', days: ['Friday'] }, started, Date.parse('2025-12-12T12:00:00Z'), tz)).toBe(true);
    expect(isLate({ open_by: '06:00' }, Date.parse('2025-12-12T13:00:00Z'), Date.parse('2025-12-12T15:00:00Z'), tz)).toBe(false);
  });
});

describe('i18n', () => {
  it('translates and interpolates', () => {
    expect(t('es', 'arrive')).toBe('Llegué');
    expect(t('en', 'of_done', { d: 6, n: 14 })).toBe('6 of 14 done');
  });
});

describe('sub pay checks', () => {
  const v = (arrived: string, departed: string) => ({ id: 'v', site_label: 'Lot', arrived_at: arrived, departed_at: departed, salt: null });
  it('flags a long hourly visit and a Done before Arrive, and leaves normal visits alone', () => {
    const hourly = { hourly_cents: 6000 };
    expect(subPayStatement(hourly, [v('2026-01-20T03:00:00Z', '2026-01-20T12:00:00Z')]).lines[0]!.check).toContain('9 h on one lot');
    expect(subPayStatement({ per_visit_cents: 4000 }, [v('2026-01-20T05:00:00Z', '2026-01-20T04:00:00Z')]).lines[0]!.check).toContain('earlier than Arrive');
    expect(subPayStatement(hourly, [v('2026-01-20T03:00:00Z', '2026-01-20T04:00:00Z')]).lines[0]!.check).toBeUndefined();
    expect(subPayStatement({ per_visit_cents: 4000 }, [v('2026-01-20T03:00:00Z', '2026-01-20T12:00:00Z')]).lines[0]!.check).toBeUndefined();
  });
});
