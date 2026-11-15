/** The rate card's limits, the same as the server's, as a sentence (issues 21 and 27). Null when everything is fine. */
/**
 * The depth tiers behind suggested tier prices (issue 153), as typed: each depth deeper than the last, the last tier
 * "above that", and each a multiple of the push price.
 */
export function tierProblem(tiers: { depth: string; mult: string }[]): string | null {
  if (tiers.length < 2) return 'Keep at least two tiers.';
  let last = 0;
  for (const [i, t] of tiers.entries()) {
    const m = Number(t.mult);
    if (t.mult.trim() === '' || !Number.isFinite(m) || m < 0.1 || m > 10) return `Tier ${i + 1}: the multiple of the push price must be between 0.1 and 10.`;
    if (i === tiers.length - 1) break;
    const d = Number(t.depth);
    if (t.depth.trim() === '' || !Number.isFinite(d) || d <= 0 || d > 120) return `Tier ${i + 1}: enter a depth in inches, from 0.5 to 120.`;
    if (d <= last) return `Tier ${i + 1}: each depth has to be deeper than the one before.`;
    last = d;
  }
  return null;
}

export function rateCardProblem(f: Record<'rate' | 'min' | 'walk' | 'salt' | 'pushes', string>): string | null {
  const n = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const checks: [string, number, number, number, boolean?][] = [
    ['Cents per sq ft', n(f.rate), 0, 100],
    ['The minimum push', n(f.min), 0, 100000],
    ['Cents per foot of walk', n(f.walk), 0, 1000],
    ['Salt per bag', n(f.salt), 0, 100000],
    ['Pushes per season', n(f.pushes), 1, 100, true],
  ];
  for (const [label, v, min, max, whole] of checks) {
    if (!Number.isFinite(v)) return `${label} needs a number.`;
    if (v < min) return min === 0 ? `${label} can't be negative.` : `${label} must be at least ${min}.`;
    if (v > max) return `${label} must be ${max.toLocaleString('en-US')} or less.`;
    if (whole && !Number.isInteger(v)) return `${label} must be a whole number.`;
  }
  return null;
}
