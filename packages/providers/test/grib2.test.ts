import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGrib2, lambertIJ, parseIdx, sampleField } from '../src/live/grib2';

/**
 * Issue 203. Real NOAA HRRR fields from 2026-11-20, 14 UTC run, 2 hours ahead:
 * - hrrr-tmp2m-cleveland: 2 m temperature cut to NE Ohio by NOMADS (simple packing, template 5.0).
 * - hrrr-asnow-f02: snowfall over the whole US (complex packing with spatial differencing, template 5.3).
 * Checked by hand on the day against NOAA's own numbers: the full US temperature field decoded here matched NOAA's
 * station guidance within a degree F at Cleveland, Denver, Minneapolis and Buffalo, and matched the cut-down file to
 * 0.125 K at all 1,410 points they share. The Blend (NBM) decoded the same way matched its station guidance too.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures-grib/${name}`, import.meta.url)));
const toF = (k: number) => (k - 273.15) * 1.8 + 32;

describe('GRIB2 reader', () => {
  it('reads the Lambert grid and a simple-packed field, and samples Cleveland Hopkins at 57 F', () => {
    const f = decodeGrib2(fixture('hrrr-tmp2m-cleveland.grib2'));
    expect(f.grid.nx * f.grid.ny).toBe(f.values.length);
    expect(f.grid.lov).toBeCloseTo(262.5, 3);
    // NOAA's station guidance (NBH) for KCLE at 16 UTC that day said 57 F.
    expect(toF(sampleField(f, 41.4117, -81.8498)!)).toBeCloseTo(57.5, 0);
    // Off the grid is no value, not zero.
    expect(sampleField(f, 45, -100)).toBeNull();
  });

  it('reads complex packing with spatial differencing over the whole US', () => {
    const f = decodeGrib2(fixture('hrrr-asnow-f02.grib2'));
    expect([f.grid.nx, f.grid.ny]).toEqual([1799, 1059]);
    expect(f.values.length).toBe(1799 * 1059);
    let max = -Infinity;
    let min = Infinity;
    let at = -1;
    let nan = 0;
    f.values.forEach((v, i) => {
      if (Number.isNaN(v)) return void nan++;
      if (v > max) { max = v; at = i; }
      min = Math.min(min, v);
    });
    expect(nan).toBe(0);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeCloseTo(0.141, 3);
    expect([at % 1799, Math.floor(at / 1799)]).toEqual([494, 705]);
    expect(sampleField(f, 41.4117, -81.8498)).toBe(0);
  });

  it('puts the first grid point at (0, 0)', () => {
    const f = decodeGrib2(fixture('hrrr-asnow-f02.grib2'));
    const lon = f.grid.lo1 > 180 ? f.grid.lo1 - 360 : f.grid.lo1;
    const { i, j } = lambertIJ(f.grid, f.grid.la1, lon);
    expect(Math.abs(i)).toBeLessThan(1e-6);
    expect(Math.abs(j)).toBeLessThan(1e-6);
  });

  it('refuses what it can not read rather than guessing', () => {
    expect(() => decodeGrib2(new TextEncoder().encode('<html>Service unavailable</html>'))).toThrow('Not a GRIB2 message');
  });

  it('parses a NOMADS .idx into byte ranges', () => {
    const idx = parseIdx('1:0:d=2026112012:ASNOW:surface:0-6 hour acc@(fcst,dt=6 hour),missing=0:50% level\n2:500:d=2026112012:ASNOW:surface:0-6 hour acc@(fcst,dt=6 hour),missing=0:90% level\n');
    expect(idx.map((e) => [e.n, e.start, e.end])).toEqual([[1, 0, 499], [2, 500, null]]);
  });
});
