import type { z } from 'zod';

/** What people call a field, where its name in the request isn't it. */
const FIELD_NAMES: Record<string, string> = {
  amount_cents: 'The price', total_cents: 'The season price', rate_cents: 'The hourly rate', trigger_in: 'The trigger depth', up_to_in: 'A tier depth',
  per_sqft_cents_per_push: 'Cents per sq ft', min_push_cents: 'The minimum push', walks_per_lf_cents: 'Cents per foot of walk', salt_bag_cents: 'Salt per bag',
  season_pushes: 'Pushes per season', sqft: 'The area', area_confirmed_sqft: 'The area', area_estimate_sqft: 'The area', walk_lf: 'Walks', walks_lf: 'Walks',
  installments: 'Installments', depth_in: 'The snow depth', phone_e164: 'The phone number',
};

/**
 * Plain sentences instead of the validator's wording (issue 27). "amount_cents: Too small: expected number to be >=0"
 * becomes "The price must be at least $0.00." Messages written for people, like a refine's, pass through as they are.
 */
export function readableIssue(issue: z.core.$ZodIssue) {
  const key = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  const name = (key && FIELD_NAMES[key]) ?? (key ? key.replace(/_e164$/, '').replace(/_|(?=[A-Z])/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'This');
  const money = Boolean(key?.endsWith('_cents')) && !key?.startsWith('per_sqft') && !key?.startsWith('walks_per');
  const show = (n: number | bigint) => (money ? `$${(Number(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(n).toLocaleString('en-US'));
  const i = issue as z.core.$ZodIssue & { origin?: string; minimum?: number | bigint; maximum?: number | bigint; inclusive?: boolean; expected?: string };
  const missing = (i.code === 'too_small' && i.origin === 'string' && Number(i.minimum) === 1) || (i.code === 'invalid_type' && /received undefined/.test(i.message));
  if (missing) return `${name} is required.`;
  if (i.code === 'too_small' && i.origin === 'number') return i.inclusive === false ? `${name} must be more than ${show(i.minimum!)}.` : `${name} must be at least ${show(i.minimum!)}.`;
  if (i.code === 'too_big' && i.origin === 'number') return i.inclusive === false ? `${name} must be less than ${show(i.maximum!)}.` : `${name} must be ${show(i.maximum!)} or less.`;
  if (i.code === 'too_small' && i.origin === 'string') return `${name} must be at least ${i.minimum} characters.`;
  if (i.code === 'too_big' && i.origin === 'string') return `${name} must be ${i.maximum} characters or fewer.`;
  if (i.code === 'too_small' && i.origin === 'array') return `Choose at least ${i.minimum}.`;
  if (i.code === 'too_big' && i.origin === 'array') return `Choose ${i.maximum} or fewer.`;
  if (i.code === 'invalid_type' && i.expected === 'int') return `${name} must be a whole number.`;
  if (i.code === 'invalid_type' && i.expected === 'number') return `${name} must be a number.`;
  if (i.code === 'invalid_format') return `${name} isn't in the right format.`;
  // A message someone wrote for people, from a refine or a regex.
  if (!/expected|invalid input/i.test(i.message)) return /[.!?]$/.test(i.message) ? i.message : `${i.message}.`;
  return `${name} isn't valid.`;
}
