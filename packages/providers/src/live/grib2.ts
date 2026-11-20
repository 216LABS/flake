/**
 * A small GRIB2 reader for the two NOAA models Flake samples (issue 203): the National Blend of Models and HRRR. Both
 * ship on a Lambert conformal grid (template 3.30) with "complex packing and spatial differencing" (template 5.3), or
 * plain simple packing (5.0). That's all this reads; anything else throws, and the caller falls back to the NWS grid.
 * Written here rather than added as a package: it's a few hundred lines, and the format is a published WMO standard.
 */

export interface LambertGrid {
  nx: number; ny: number;
  la1: number; lo1: number;
  lov: number; latin1: number; latin2: number;
  dx: number; dy: number;
  radius: number;
  /** Scanning mode flags (WMO code table 3.4). */
  scan: number;
}

export interface Grib2Field { grid: LambertGrid; values: Float64Array }

/** Reads a big-endian bit stream. */
class Bits {
  private pos = 0;
  constructor(private readonly b: Uint8Array, start: number) { this.pos = start * 8; }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.pos >> 3]!;
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  align() { this.pos = Math.ceil(this.pos / 8) * 8; }
}

const u8 = (b: Uint8Array, o: number) => b[o]!;
const u16 = (b: Uint8Array, o: number) => b[o]! * 256 + b[o + 1]!;
const u32 = (b: Uint8Array, o: number) => ((b[o]! * 256 + b[o + 1]!) * 256 + b[o + 2]!) * 256 + b[o + 3]!;
/** GRIB2 signed integers are sign and magnitude, not two's complement. */
const s16 = (b: Uint8Array, o: number) => (b[o]! & 0x80 ? -(u16(b, o) & 0x7fff) : u16(b, o));
const s32 = (b: Uint8Array, o: number) => (b[o]! & 0x80 ? -(u32(b, o) - 0x80000000) : u32(b, o));
const f32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
const signMag = (v: number, bytes: number) => {
  const top = 2 ** (bytes * 8 - 1);
  return v >= top ? -(v - top) : v;
};

/** Earth radius by shape of the earth (code table 3.2). NOAA's models use a sphere. */
function radiusOf(b: Uint8Array, o: number): number {
  const shape = u8(b, o);
  if (shape === 1) return u32(b, o + 2) / 10 ** u8(b, o + 1);
  if (shape === 0) return 6367470;
  return 6371229;
}

/** Decodes the first message in `bytes` (one field, as fetched by byte range from the .idx). */
export function decodeGrib2(bytes: Uint8Array): Grib2Field {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'GRIB' || bytes[7] !== 2) throw new Error('Not a GRIB2 message');
  let grid: LambertGrid | null = null;
  let packing: { template: number; at: number } | null = null;
  let bitmap: Uint8Array | null = null;
  let data: number | null = null;
  let o = 16;
  while (o < bytes.length - 4) {
    if (bytes[o] === 0x37 && bytes[o + 1] === 0x37 && bytes[o + 2] === 0x37 && bytes[o + 3] === 0x37) break;
    const len = u32(bytes, o);
    const n = u8(bytes, o + 4);
    if (n === 3) {
      const template = u16(bytes, o + 12);
      if (template !== 30) throw new Error(`Grid template 3.${template} is not supported`);
      const t = o + 14;
      const lat = (x: number) => s32(bytes, x) / 1e6;
      const lon = (x: number) => u32(bytes, x) / 1e6;
      grid = {
        radius: radiusOf(bytes, t),
        nx: u32(bytes, t + 16), ny: u32(bytes, t + 20),
        la1: lat(t + 24), lo1: lon(t + 28),
        lov: lon(t + 37),
        dx: u32(bytes, t + 41) / 1000, dy: u32(bytes, t + 45) / 1000,
        scan: u8(bytes, t + 50),
        latin1: lat(t + 51), latin2: lat(t + 55),
      };
    } else if (n === 5) {
      packing = { template: u16(bytes, o + 9), at: o };
    } else if (n === 6) {
      const indicator = u8(bytes, o + 5);
      if (indicator === 0) bitmap = bytes.subarray(o + 6, o + len);
      else if (indicator !== 255) throw new Error('Predefined bitmaps are not supported');
    } else if (n === 7) {
      data = o + 5;
    }
    o += len;
  }
  if (!grid || !packing || data === null) throw new Error('Incomplete GRIB2 message');
  const count = grid.nx * grid.ny;
  const packed = unpack(bytes, packing.at, packing.template, data);
  const values = new Float64Array(count);
  if (!bitmap) {
    if (packed.length !== count) throw new Error('GRIB2 value count mismatch');
    values.set(packed);
  } else {
    let k = 0;
    for (let i = 0; i < count; i++) values[i] = (bitmap[i >> 3]! >> (7 - (i & 7))) & 1 ? packed[k++]! : NaN;
  }
  // Scanning bit 0x10: every other row runs the opposite way (the Blend does this). Put them all one way round.
  if (grid.scan & 0x10) {
    for (let row = 1; row < grid.ny; row += 2) values.subarray(row * grid.nx, (row + 1) * grid.nx).reverse();
  }
  return { grid, values };
}

/** Section 5 at `s5`, section 7's data at `d`. Missing values come back as NaN. */
function unpack(b: Uint8Array, s5: number, template: number, d: number): Float64Array {
  const n = u32(b, s5 + 5);
  const R = f32(b, s5 + 11);
  const E = s16(b, s5 + 15);
  const D = s16(b, s5 + 17);
  const nbits = u8(b, s5 + 19);
  const scale = (i: number) => (R + i * 2 ** E) / 10 ** D;
  const out = new Float64Array(n);
  if (template === 0) {
    const bits = new Bits(b, d);
    for (let i = 0; i < n; i++) out[i] = scale(nbits ? bits.read(nbits) : 0);
    return out;
  }
  if (template !== 2 && template !== 3) throw new Error(`Data template 5.${template} is not supported`);
  const missingMode = u8(b, s5 + 22);
  const ng = u32(b, s5 + 31);
  const widthRef = u8(b, s5 + 35);
  const widthBits = u8(b, s5 + 36);
  const lengthRef = u32(b, s5 + 37);
  const lengthInc = u8(b, s5 + 41);
  const lastLength = u32(b, s5 + 42);
  const lengthBits = u8(b, s5 + 46);
  const order = template === 3 ? u8(b, s5 + 47) : 0;
  const ndesc = template === 3 ? u8(b, s5 + 48) : 0;

  const bits = new Bits(b, d);
  const firsts: number[] = [];
  let minsd = 0;
  if (order > 0) {
    for (let i = 0; i < order; i++) firsts.push(signMag(bits.read(ndesc * 8), ndesc));
    minsd = signMag(bits.read(ndesc * 8), ndesc);
  }
  const refs = new Array<number>(ng);
  for (let g = 0; g < ng; g++) refs[g] = bits.read(nbits);
  bits.align();
  const widths = new Array<number>(ng);
  for (let g = 0; g < ng; g++) widths[g] = bits.read(widthBits) + widthRef;
  bits.align();
  const lengths = new Array<number>(ng);
  for (let g = 0; g < ng; g++) lengths[g] = bits.read(lengthBits) * lengthInc + lengthRef;
  bits.align();
  if (ng) lengths[ng - 1] = lastLength;

  // Integers per point, with missing marked; then undo the spatial differencing over the points that aren't missing.
  const ints = new Float64Array(n);
  const missing = new Uint8Array(n);
  let k = 0;
  for (let g = 0; g < ng; g++) {
    const w = widths[g]!;
    const ref = refs[g]!;
    const allOnes = 2 ** w - 1;
    const refMissing = missingMode > 0 && w === 0 && ref === 2 ** nbits - 1;
    for (let i = 0; i < lengths[g]! && k < n; i++, k++) {
      if (w === 0) {
        if (refMissing) missing[k] = 1;
        else ints[k] = ref;
        continue;
      }
      const v = bits.read(w);
      if (missingMode > 0 && (v === allOnes || (missingMode === 2 && v === allOnes - 1))) missing[k] = 1;
      else ints[k] = v + ref;
    }
  }
  if (order > 0) {
    // Walked in place over the points that aren't missing, keeping the last two values, rather than listing them.
    let seen = 0;
    let prev = 0;
    let prev2 = 0;
    for (let i = 0; i < n; i++) {
      if (missing[i]) continue;
      const v = seen < order ? firsts[seen]! : order === 1 ? ints[i]! + minsd + prev : ints[i]! + minsd + 2 * prev - prev2;
      ints[i] = v;
      prev2 = prev;
      prev = v;
      seen++;
    }
  }
  for (let i = 0; i < n; i++) out[i] = missing[i] ? NaN : scale(ints[i]!);
  return out;
}

const rad = (d: number) => (d * Math.PI) / 180;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Grid position (fractional i, j) of a latitude and longitude on a Lambert conformal grid, on a sphere. */
export function lambertIJ(g: LambertGrid, lat: number, lon: number): { i: number; j: number } {
  const p1 = rad(g.latin1);
  const p2 = rad(g.latin2);
  const n = Math.abs(p1 - p2) < 1e-9 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
  const F = (Math.cos(p1) * Math.tan(Math.PI / 4 + p1 / 2) ** n) / n;
  const rho = (phi: number) => (g.radius * F) / Math.tan(Math.PI / 4 + rad(phi) / 2) ** n;
  const xy = (phi: number, lam: number) => {
    const theta = n * rad(wrap(lam - g.lov));
    const r = rho(phi);
    return { x: r * Math.sin(theta), y: -r * Math.cos(theta) };
  };
  const a = xy(lat, lon);
  const o = xy(g.la1, g.lo1);
  // Scanning mode: bit 0x80 set means i runs west, bit 0x40 set means j runs north.
  const i = ((a.x - o.x) / g.dx) * (g.scan & 0x80 ? -1 : 1);
  const j = ((a.y - o.y) / g.dy) * (g.scan & 0x40 ? 1 : -1);
  return { i, j };
}

/** The value at the grid point nearest each lat/lon, or null outside the grid or where it's missing. */
export function sampleField(f: Grib2Field, lat: number, lon: number): number | null {
  const { i, j } = lambertIJ(f.grid, lat, lon);
  const ii = Math.round(i);
  const jj = Math.round(j);
  if (ii < 0 || jj < 0 || ii >= f.grid.nx || jj >= f.grid.ny) return null;
  const v = f.values[jj * f.grid.nx + ii]!;
  return Number.isFinite(v) ? v : null;
}

/** One line of a NOAA .idx inventory: "150:133256177:d=2026112012:ASNOW:surface:6-12 hour acc...:50% level". */
export interface IdxEntry { n: number; start: number; end: number | null; line: string }
export function parseIdx(text: string): IdxEntry[] {
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [n, start] = line.split(':');
    return { n: Number(n), start: Number(start), line };
  });
  return rows.map((r, i) => ({ ...r, end: rows[i + 1] ? rows[i + 1]!.start - 1 : null }));
}
