/** How a billing mode reads to a person, wherever it's shown. */
export const BILLING_LABEL: Record<string, string> = {
  card_on_file: 'Card on file',
  ach_on_file: 'Bank (ACH) on file',
  invoice_net30: 'Net-30 invoice',
  manual: 'Manual',
};
export const billingLabel = (mode: string) => BILLING_LABEL[mode] ?? mode.replace(/_/g, ' ');

export const KIND_LABEL: Record<string, string> = { commercial: 'Commercial', residential: 'Residential', hoa: 'HOA' };
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** A storm's status as the next thing to do: closed means it still needs billing. */
export const STORM_STATUS: Record<string, { word: string; tone: 'blue' | 'amber' | 'green' }> = {
  active: { word: 'Live', tone: 'blue' },
  closed: { word: 'Ready to bill', tone: 'amber' },
  billed: { word: 'Billed', tone: 'green' },
};
export const stormStatus = (status: string) => STORM_STATUS[status] ?? { word: status, tone: 'amber' as const };
