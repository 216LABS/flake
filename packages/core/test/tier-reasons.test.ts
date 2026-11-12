import { describe, expect, it } from 'vitest';
import { tierReasons } from '../src/billing';

describe('billing summary names only the flags that are there (issue 75 retest)', () => {
  it('a bill missing only its location does not say "no after photo"', () => {
    expect(tierReasons('proof', ['no_gps_match'])).toBe('no or far-off location');
    expect(tierReasons('proof', ['no_after_photo', 'no_gps_match', 'no_after_photo'])).toBe('no after photo, no or far-off location');
  });
  it('keeps to its own tier and says each reason once', () => {
    expect(tierReasons('money', ['no_contract', 'no_gps_match', 'salt_unit', 'missing_salt_qty'])).toBe('no price, salt missing');
    expect(tierReasons('proof', [])).toBe('');
  });
});
