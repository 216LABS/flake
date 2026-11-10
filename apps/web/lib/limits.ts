/** The rate card's limits, the same as the server's, as a sentence (issues 21 and 27). Null when everything is fine. */
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
