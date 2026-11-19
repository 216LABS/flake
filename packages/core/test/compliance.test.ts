import { describe, expect, it } from 'vitest';
import { certState, subCoverage } from '../src/compliance';

describe('issue 165: certificates', () => {
  it('expiring within 30 days, expired after the end date', () => {
    expect(certState('2027-03-01', '2027-01-15')).toBe('ok');
    expect(certState('2027-02-14', '2027-01-15')).toBe('expiring');
    expect(certState('2027-01-15', '2027-01-15')).toBe('expiring');
    expect(certState('2027-01-14', '2027-01-15')).toBe('expired');
    expect(certState(null, '2027-01-15')).toBe('no_end');
  });
  it('a sub is covered by any current certificate of insurance; a W-9 alone is not cover', () => {
    expect(subCoverage([], '2027-01-15')).toBe('missing');
    expect(subCoverage([{ kind: 'w9', expires_on: null }], '2027-01-15')).toBe('missing');
    expect(subCoverage([{ kind: 'general_liability', expires_on: '2026-12-31' }], '2027-01-15')).toBe('expired');
    expect(subCoverage([{ kind: 'general_liability', expires_on: '2026-12-31' }, { kind: 'auto', expires_on: '2027-01-30' }], '2027-01-15')).toBe('expiring');
    expect(subCoverage([{ kind: 'general_liability', expires_on: '2026-12-31' }, { kind: 'general_liability', expires_on: '2027-12-31' }], '2027-01-15')).toBe('covered');
  });
});
