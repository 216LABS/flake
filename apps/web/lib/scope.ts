import { money } from './client';

/** One service's price in plain words, the same on the quote page and the office's contract list. */
export function priceText(p: any): string {
  if (!p) return 'priced per unit';
  switch (p.type) {
    case 'per_push': return `${money(p.amount_cents)} per push`;
    case 'per_event': return `${money(p.amount_cents)} per storm`;
    case 'hourly': return `${money(p.rate_cents)} per hour, rounded up to 15 minutes`;
    case 'seasonal': return `${money(p.total_cents)} for the season, in ${p.installments} installments`;
    case 'per_inch_tier': return p.tiers.map((t: any) => `${t.up_to_in ? `up to ${t.up_to_in}"` : 'above that'}: ${money(t.amount_cents)}`).join('; ');
    default: return '';
  }
}

const SALT_UNIT: Record<string, string> = { bag50lb: '50 lb bag', lb: 'lb', ton: 'ton', application: 'application' };

/** "Plow: $45.00 per push. Starts at 2" of snow." */
export function scopeLine(s: { service: string; trigger_in?: number | null; pricing?: any }, salt: { unit: string; amount_cents: number } | null | undefined): string {
  const price = s.service === 'salt' && salt ? `${money(salt.amount_cents)} per ${SALT_UNIT[salt.unit] ?? salt.unit}` : priceText(s.pricing);
  const when = s.trigger_in === 0 ? '. Starts with any measurable snow.' : s.trigger_in != null ? `. Starts at ${s.trigger_in}" of snow.` : '';
  return `${s.service[0]!.toUpperCase()}${s.service.slice(1)}: ${price}${when}`;
}

/**
 * How the customer pays, said on the quote and in the signed agreement, so nobody signs without knowing (the terms
 * otherwise said only "as stated on each invoice").
 */
export function paymentText(mode: string, company: string, online = true): string {
  // Before the company turns on online payments there's no card form after accepting, so it doesn't promise one.
  switch (mode) {
    case 'card_on_file': return online ? 'Charged to a card on file after each storm. You add the card after accepting.' : `Charged to a card on file after each storm. ${company} will send you a secure link to add your card.`;
    case 'ach_on_file': return online ? 'Paid from a bank account on file after each storm. You add the account after accepting.' : `Paid from a bank account on file after each storm. ${company} will send you a secure link to add the account.`;
    case 'invoice_net30': return 'Invoiced after each storm, due within 30 days.';
    default: return `Invoiced by ${company} after each storm.`;
  }
}
