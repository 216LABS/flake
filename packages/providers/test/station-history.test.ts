import { describe, expect, it } from 'vitest';
import { parseStationCsv, stationHistoryUrl } from '../src/live/weather';
import { MockWeather } from '../src/mock/weather';

describe('observed weather from the airport station archive (issue 163)', () => {
  it('asks for routine and special reports, dropping the K only on lower-48 station codes', () => {
    const from = new Date('2026-01-10T00:00:00Z');
    const to = new Date('2026-01-10T06:00:00Z');
    const url = new URL(stationHistoryUrl('KCLE', from, to));
    expect(url.searchParams.get('station')).toBe('CLE');
    expect(url.searchParams.get('sts')).toBe('2026-01-10T00:00Z');
    expect(url.searchParams.getAll('report_type')).toEqual(['3', '4']);
    expect(url.searchParams.getAll('data')).toEqual(['tmpf', 'p01i', 'wxcodes', 'snowdepth']);
    expect(new URL(stationHistoryUrl('PANC', from, to)).searchParams.get('station')).toBe('PANC');
  });

  it('reads the archive CSV, with missing values as null, never zero', () => {
    const rows = parseStationCsv('station,valid,tmpf,p01i,wxcodes,snowdepth\nCLE,2026-01-10 00:51,42.00,0.00,null,null\nCLE,2026-01-10 01:51,31.00,0.0001,-FZRA BR,2.00\nCLE,2026-01-10 02:51,M,null,null,M\n');
    expect(rows).toEqual([
      { t: '2026-01-10T00:51:00.000Z', temp_f: 42, precip_in: 0, wx: null, snow_depth_in: null },
      { t: '2026-01-10T01:51:00.000Z', temp_f: 31, precip_in: 0.0001, wx: '-FZRA BR', snow_depth_in: 2 },
      { t: '2026-01-10T02:51:00.000Z', temp_f: null, precip_in: null, wx: null, snow_depth_in: null },
    ]);
    expect(parseStationCsv('station,valid,tmpf\n')).toEqual([]);
  });

  it('demo mode gives clearly synthetic hourly reports with a thaw and a freeze each day', async () => {
    const h = await new MockWeather('quiet').fetchStationHistory('KCLE', new Date('2026-01-10T00:00:00Z'), new Date('2026-01-11T00:00:00Z'));
    expect(h?.synthetic).toBe(true);
    expect(h!.rows.length).toBe(25);
    expect(h!.rows.some((r) => r.temp_f! > 32) && h!.rows.some((r) => r.temp_f! <= 32)).toBe(true);
  });
});
