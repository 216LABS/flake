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

export const PRICING_LABEL: Record<string, string> = { per_push: 'Per push', per_inch_tier: 'Per inch tiers', per_event: 'Per event', seasonal: 'Seasonal', hourly: 'Hourly' };
export const pricingLabel = (type: string) => PRICING_LABEL[type] ?? type.replace(/_/g, ' ');

/** The message log's columns, as a person reads them. */
export const MESSAGE_LABEL: Record<string, string> = {
  call_out: 'Call-out', completion_report: 'Service record', crew_invite: 'Crew invite', crew_link: 'Driver link', done: 'Lot done',
  invoice: 'Invoice', late: 'Running late', on_the_way: 'On the way', owner_alert: 'Owner alert', portal: 'Records link', quote: 'Quote',
  receipt: 'Receipt', route_changed: 'Route changed', salt_supplier: 'Salt order', team_invite: 'Team invite',
};
export const messageLabel = (template: string) => MESSAGE_LABEL[template] ?? template.replace(/_/g, ' ');
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', sms: 'Text', push: 'Push' };
export const MESSAGE_STATUS: Record<string, string> = {
  sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', gone: 'Phone unsubscribed',
  not_sent: 'Not sent: email is off', rejected: 'Rejected: address not valid',
};
export const messageStatus = (status: string | null) => (status ? MESSAGE_STATUS[status] ?? status.replace(/_/g, ' ') : '');

/** A background job, named by what it does. */
export const JOB_LABEL: Record<string, string> = {
  'billing.charge': 'Charge a customer', 'billing.installments': 'Bill seasonal installments', 'billing.redraft': 'Redo a storm\'s bills',
  'notify.customer': 'Customer message', 'notify.invoice_sms': 'Invoice text', 'notify.party': 'Message', 'notify.push': 'Phone alert',
  'notify.route_changed': 'Route change text', 'notify.visit_done': 'Lot done message', 'photo.process': 'Process a photo',
  'proof.render': 'Build a proof packet', 'report.completion': 'Service record email', 'salt.supplier_email': 'Salt order email',
  'sms.mock_approve': 'Texting approval (test)', 'sms.tollfree_submit': 'Texting number request', 'storm.publish_links': 'Send driver links',
  'trigger.evaluate': 'Check snow triggers', 'weather.fetch_alerts': 'Weather alerts', 'weather.fetch_cell': 'Forecast update', 'weather.nohrsc': 'Snowfall report',
};
export const jobLabel = (kind: string) => JOB_LABEL[kind] ?? kind.replace(/[._]/g, ' ');
