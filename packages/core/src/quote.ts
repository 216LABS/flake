export interface RateCard {
  per_sqft_cents_per_push: number;
  min_push_cents: number;
  walks_per_lf_cents: number;
  salt_bag_cents: number;
  season_pushes: number;
  /** Depth tiers as multipliers of the base push price. */
  tiers: { up_to_in: number | null; multiplier: number }[];
}

/** Starting assumptions, labeled as such in the UI. Not market data; every operator should set their own. */
export const DEFAULT_RATE_CARD: RateCard = {
  per_sqft_cents_per_push: 0.6,
  min_push_cents: 4500,
  walks_per_lf_cents: 15,
  salt_bag_cents: 1800,
  season_pushes: 20,
  tiers: [
    { up_to_in: 4, multiplier: 1 },
    { up_to_in: 8, multiplier: 1.5 },
    { up_to_in: null, multiplier: 2 },
  ],
};

export interface QuoteInput {
  sqft: number;
  walks_lf?: number;
}

export interface QuoteEstimate {
  per_push_cents: number;
  per_event_cents: number;
  seasonal_cents: number;
  tiers: { up_to_in: number | null; amount_cents: number }[];
  salt_bag_cents: number;
}

const to5Dollars = (cents: number) => Math.round(cents / 500) * 500;

export function suggestPrice(input: QuoteInput, card: RateCard = DEFAULT_RATE_CARD): QuoteEstimate {
  const base = input.sqft * card.per_sqft_cents_per_push + (input.walks_lf ?? 0) * card.walks_per_lf_cents;
  const push = to5Dollars(Math.max(card.min_push_cents, base));
  return {
    per_push_cents: push,
    per_event_cents: to5Dollars(push * 1.5),
    seasonal_cents: to5Dollars(push * card.season_pushes),
    tiers: card.tiers.map((t) => ({ up_to_in: t.up_to_in, amount_cents: to5Dollars(push * t.multiplier) })),
    salt_bag_cents: card.salt_bag_cents,
  };
}
