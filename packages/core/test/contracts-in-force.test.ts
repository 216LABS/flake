import { describe, expect, it } from 'vitest';
import { contractsInForce } from '../src/time';

type C = { id: string; season: string; site_id: string; status: string; accepted_at: string | null };
const c = (id: string, status: string, accepted_at: string | null, site_id = 's1', season = '2026-27'): C => ({ id, season, site_id, status, accepted_at });
const at = (d: string) => new Date(d);

describe('contractsInForce (issue 109)', () => {
  const v1 = c('v1', 'void', '2026-11-01T12:00:00Z');
  const v2 = c('v2', 'accepted', '2026-12-15T12:00:00Z');
  it('a storm before the re-signature uses the replaced agreement', () => {
    expect(contractsInForce([v2, v1], at('2026-12-10T10:00:00Z'), 'America/New_York').map((x) => x.id)).toEqual(['v1']);
  });
  it('a storm after the re-signature uses the new one', () => {
    expect(contractsInForce([v2, v1], at('2026-12-20T10:00:00Z'), 'America/New_York').map((x) => x.id)).toEqual(['v2']);
  });
  it('a contract the office voided with nothing after it counts for nothing', () => {
    expect(contractsInForce([c('x', 'void', '2026-11-01T12:00:00Z')], at('2026-12-10T10:00:00Z'))).toEqual([]);
  });
  it('a void that was never signed is not a replaced agreement', () => {
    expect(contractsInForce([v2, c('q', 'void', null)], at('2026-12-10T10:00:00Z'), 'America/New_York').map((x) => x.id)).toEqual(['v2']);
  });
  it('signed only after the storm started (agreed mid-storm): the current agreement', () => {
    expect(contractsInForce([v2], at('2026-12-10T10:00:00Z'), 'America/New_York').map((x) => x.id)).toEqual(['v2']);
  });
  it('an accepted contract with no signing time still counts as before the storm', () => {
    expect(contractsInForce([c('legacy', 'accepted', null)], at('2026-12-10T10:00:00Z'), 'America/New_York').map((x) => x.id)).toEqual(['legacy']);
  });
  it('keeps lots apart, and next season\'s renewal never prices this storm', () => {
    const next = c('n', 'accepted', '2026-12-01T12:00:00Z', 's1', '2027-28');
    const other = c('o', 'accepted', '2026-10-01T12:00:00Z', 's2');
    const out = contractsInForce([next, v2, v1, other], at('2026-12-10T10:00:00Z'), 'America/New_York').map((x) => x.id).sort();
    expect(out).toEqual(['o', 'v1']);
  });
});
