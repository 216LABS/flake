import { describe, expect, it } from 'vitest';
import { currentSeason, liveContract, liveContracts } from '../src/time';

const nov = new Date('2026-11-09T12:00:00');

describe('the contract in force', () => {
  it('the one for this season wins, even over a newer renewal', () => {
    const list = [{ id: 'renewal', season: '2027-28' }, { id: 'now', season: '2026-27' }];
    expect(liveContract(list, nov)?.id).toBe('now');
  });

  it('a renewal for a later season never prices today, even alone', () => {
    expect(liveContract([{ id: 'renewal', season: '2027-28' }], nov)).toBeUndefined();
  });

  it('last season still covers a lot that has not renewed yet', () => {
    expect(liveContract([{ id: 'old', season: '2025-26' }], nov)?.id).toBe('old');
  });

  it('a season written some other way falls back to the newest', () => {
    expect(liveContract([{ id: 'a', season: 'Winter 26' }, { id: 'b', season: 'Winter 25' }], nov)?.id).toBe('a');
  });

  it('per lot', () => {
    const list = [{ id: 'r', site_id: 'x', season: '2027-28' }, { id: 'n', site_id: 'x', season: '2026-27' }, { id: 'y', site_id: 'y', season: '2026-27' }];
    expect(liveContracts(list, nov).map((c) => c.id).sort()).toEqual(['n', 'y']);
  });

  it('seasons turn over in July', () => {
    expect(currentSeason(new Date('2027-06-30T12:00:00'))).toBe('2026-27');
    expect(currentSeason(new Date('2027-07-01T12:00:00'))).toBe('2027-28');
  });
});

describe('quotingSeason', () => {
  it('a quote written April to June is for next winter; the rest of the year, this one', async () => {
    const { quotingSeason } = await import('../src/time');
    expect(quotingSeason(new Date('2026-11-13T15:00:00Z'), 'America/New_York')).toBe('2026-27');
    expect(quotingSeason(new Date('2027-02-10T15:00:00Z'), 'America/New_York')).toBe('2026-27');
    expect(quotingSeason(new Date('2027-05-10T15:00:00Z'), 'America/New_York')).toBe('2027-28');
    expect(quotingSeason(new Date('2027-07-02T15:00:00Z'), 'America/New_York')).toBe('2027-28');
    expect(quotingSeason(new Date(2027, 3, 15))).toBe('2027-28');
  });
});
