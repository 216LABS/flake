export type Plan = 'free' | 'pro';
export type PayMethod = 'card' | 'ach' | 'invoice_ach' | 'invoice_card';

/** Pure YYYY-MM-DD comparison: the free season runs through its end date inclusive. */
export function inFreeSeason(freeSeasonUntil: string | null | undefined, todayIso: string): boolean {
  return Boolean(freeSeasonUntil) && String(freeSeasonUntil) >= todayIso;
}

/**
 * 1% on free, 0.5% on a paid Pro plan. During the free first season the Pro charge is waived but the
 * fee stays 1% (DECISIONS D5: "no Pro charge, and the application fee is still 1%").
 */
export function feeRate(plan: Plan, freeSeasonUntil: string | null | undefined, todayIso: string): number {
  return plan === 'pro' && !inFreeSeason(freeSeasonUntil, todayIso) ? 0.005 : 0.01;
}

/** fee = clamp(round(amount x rate), 50, 2500) cents, and never more than the amount itself. */
export function applicationFeeCents(amountCents: number, rate: number): number {
  if (amountCents <= 0) return 0;
  const fee = Math.min(2500, Math.max(50, Math.round(amountCents * rate)));
  return Math.min(fee, amountCents);
}

/** Owner-facing estimate only: card 2.9% + 30c; ACH 0.8% capped at $5; Stripe Invoicing adds 0.4%. */
export function estimateStripeFeeCents(amountCents: number, method: PayMethod): number {
  if (amountCents <= 0) return 0;
  const card = Math.round(amountCents * 0.029) + 30;
  const ach = Math.min(500, Math.round(amountCents * 0.008));
  const invoicing = Math.round(amountCents * 0.004);
  if (method === 'card') return card;
  if (method === 'ach') return ach;
  return (method === 'invoice_ach' ? ach : card) + invoicing;
}

/** Pro features are unlocked for paying Pro tenants and everyone inside the free first season. */
export function proFeaturesEnabled(plan: Plan, freeSeasonUntil: string | null | undefined, todayIso: string): boolean {
  return plan === 'pro' || inFreeSeason(freeSeasonUntil, todayIso);
}

export const FREE_SITE_LIMIT = 25;
export const FREE_SEASON_END = '2027-04-30';
