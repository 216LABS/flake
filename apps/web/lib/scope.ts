import { seasonalInstallments, seasonalRemaining } from '@flake/core/pricing';
import { currentSeason, isLaterSeason, liveContracts } from '@flake/core/time';
import { money } from './client';

/**
 * Which signed agreement covers a lot this winter, in words (issue 157): a renewal signed for next winter doesn't, and
 * last winter's carries on until this winter's is signed, which billing review also points out.
 */
export function contractStanding(accepted: { season: string; site_id: string }[], now: Date, tz: string): { text: string; tone: 'green' | 'amber'; inForce: string | null } | null {
  if (!accepted.length) return null;
  const season = currentSeason(now, tz);
  const live = liveContracts(accepted, now, tz)[0] ?? null;
  const later = [...new Set(accepted.filter((c) => isLaterSeason(c.season, season)).map((c) => c.season))].sort();
  const ahead = later.length ? ` ${later.join(', ')} signed.` : '';
  if (live?.season === season) return { text: `Signed ${season}.${ahead}`, tone: 'green', inForce: live.season };
  if (live) return { text: `${live.season} carried over: no ${season} contract.${ahead}`, tone: 'amber', inForce: live.season };
  return { text: `No ${season} contract.${ahead}`, tone: 'amber', inForce: null };
}

/** Installments already billed for this lot and season under an earlier agreement (issue 156). */
export interface PriorBilled { cents: number; count: number }

const eachText = (amounts: number[]) => {
  const [first, ...rest] = amounts;
  return rest.length && rest.some((x) => x !== first) ? `${money(first!)} then ${money(rest[0]!)}` : money(first!);
};

/**
 * A seasonal price as a plan the customer can budget for (issue 120): "$900.00 for the season: 5 monthly installments
 * of $180.00". With the season, it says when the first one is billed: the month they sign, or the July a season signed
 * ahead of time starts, which is when the installment job starts billing it.
 */
export function seasonalPlan(p: { total_cents: number; installments: number }, season?: string, now = new Date(), prior?: PriorBilled | null): string {
  // A re-sign mid-season: say what will actually be billed, not the full schedule the new price alone would give.
  if (prior && (prior.cents > 0 || prior.count > 0)) {
    const left = seasonalRemaining(p.total_cents, p.installments, prior);
    const sum = left.reduce((n, x) => n + x, 0);
    const head = `${money(p.total_cents)} for the season. ${money(prior.cents)} already billed under your earlier agreement`;
    if (!left.length) return `${head}, so nothing more is billed for this season.`;
    return `${head}; the remaining ${money(sum)} in ${left.length === 1 ? `one installment of ${money(sum)}` : `${left.length} monthly installments of ${eachText(left)}`}`;
  }
  const plan = `${money(p.total_cents)} for the season: ${p.installments === 1 ? `one installment of ${eachText(seasonalInstallments(p.total_cents, 1))}` : `${p.installments} monthly installments of ${eachText(seasonalInstallments(p.total_cents, p.installments))}`}`;
  if (!season) return plan;
  return isLaterSeason(season, currentSeason(now)) ? `${plan}, the first in July ${season.slice(0, 4)}` : `${plan}, the first in the month you sign`;
}

/** One service's price in plain words, the same on the quote page and the office's contract list. */
export function priceText(p: any, season?: string, prior?: PriorBilled | null): string {
  if (!p) return 'priced per unit';
  switch (p.type) {
    case 'per_push': return `${money(p.amount_cents)} per push`;
    case 'per_event': return `${money(p.amount_cents)} per storm`;
    case 'hourly': return `${money(p.rate_cents)} per hour, rounded up to 15 minutes`;
    case 'seasonal': return seasonalPlan(p, season, new Date(), prior);
    case 'per_inch_tier': return p.tiers.map((t: any) => `${t.up_to_in ? `up to ${t.up_to_in}"` : 'above that'}: ${money(t.amount_cents)}`).join('; ');
    default: return '';
  }
}

const SALT_UNIT: Record<string, string> = { bag50lb: '50 lb bag', lb: 'lb', ton: 'ton', application: 'application' };

/** "Plow: $45.00 per push. Starts at 2" of snow." */
export function scopeLine(s: { service: string; trigger_in?: number | null; pricing?: any }, salt: { unit: string; amount_cents: number } | null | undefined, prior?: PriorBilled | null): string {
  const price = s.service === 'salt' && salt ? `${money(salt.amount_cents)} per ${SALT_UNIT[salt.unit] ?? salt.unit}` : priceText(s.pricing, undefined, prior);
  const when = s.trigger_in === 0 ? '. Starts with any measurable snow.' : s.trigger_in != null ? `. Starts at ${s.trigger_in}" of snow.` : '';
  return `${s.service[0]!.toUpperCase()}${s.service.slice(1)}: ${price}${when}`;
}

/**
 * How the customer pays, said on the quote and in the signed agreement, so nobody signs without knowing (the terms
 * otherwise said only "as stated on each invoice").
 */
export function paymentText(mode: string, company: string, online = true, billed: { perStorm: boolean; seasonal: boolean } = { perStorm: true, seasonal: false }): string {
  // A quote of only seasonal lots is billed by installment, never after each storm (issue 120).
  if (billed.seasonal && !billed.perStorm) {
    switch (mode) {
      case 'card_on_file': return online ? 'Each installment is charged to a card on file. You add the card after accepting.' : `Each installment is charged to a card on file. ${company} will send you a secure link to add your card.`;
      case 'ach_on_file': return online ? 'Each installment is paid from a bank account on file. You add the account after accepting.' : `Each installment is paid from a bank account on file. ${company} will send you a secure link to add the account.`;
      case 'invoice_net30': return 'Each installment is invoiced, due within 30 days.';
      default: return `Invoiced by ${company} for each installment.`;
    }
  }
  const storm = stormPayment(mode, company, online);
  return billed.seasonal ? `${storm} Seasonal prices are billed by monthly installment instead.` : storm;
}

/** Whether a contract has anything billed after each storm, and anything billed by installment. */
export function billedBy(contracts: { services: unknown }[]): { perStorm: boolean; seasonal: boolean } {
  const all = contracts.flatMap((k) => k.services as { pricing?: { type?: string } }[]);
  return { perStorm: all.some((s) => s.pricing?.type !== 'seasonal'), seasonal: all.some((s) => s.pricing?.type === 'seasonal') };
}

function stormPayment(mode: string, company: string, online: boolean): string {
  // Before the company turns on online payments there's no card form after accepting, so it doesn't promise one.
  switch (mode) {
    case 'card_on_file': return online ? 'Charged to a card on file after each storm. You add the card after accepting.' : `Charged to a card on file after each storm. ${company} will send you a secure link to add your card.`;
    case 'ach_on_file': return online ? 'Paid from a bank account on file after each storm. You add the account after accepting.' : `Paid from a bank account on file after each storm. ${company} will send you a secure link to add the account.`;
    case 'invoice_net30': return 'Invoiced after each storm, due within 30 days.';
    default: return `Invoiced by ${company} after each storm.`;
  }
}
