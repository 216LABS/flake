/**
 * Distances the way a US crew reads them (issue 89): feet when close, rounded to 50, and miles with one decimal past
 * about 1,000 ft. The driver page and the billing flags use this one rule, so they never disagree.
 */
export function usDistance(meters: number): { d: string; unit: 'ft' | 'mi' } {
  return meters < 300
    ? { d: String(Math.round((meters * 3.28084) / 50) * 50), unit: 'ft' }
    : { d: (meters / 1609.344).toFixed(1), unit: 'mi' };
}

export const usDistanceText = (meters: number) => {
  const { d, unit } = usDistance(meters);
  return `${d} ${unit}`;
};

/** A short length, like GPS accuracy, in whole feet. */
export const feet = (meters: number) => `${Math.round(meters * 3.28084)} ft`;
