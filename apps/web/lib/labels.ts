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
