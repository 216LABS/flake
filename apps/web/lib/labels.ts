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
export const STORM_STATUS: Record<string, { word: string; tone: 'blue' | 'amber' | 'green' | 'gray' }> = {
  active: { word: 'Live', tone: 'blue' },
  closed: { word: 'Ready to bill', tone: 'amber' },
  billed: { word: 'Billed', tone: 'green' },
};
/** A billed storm whose every bill was voided billed nothing, so it says that (issue 135). */
export const stormStatus = (status: string, billedNothing = false) =>
  status === 'billed' && billedNothing ? { word: 'Closed, no bills', tone: 'gray' as const } : STORM_STATUS[status] ?? { word: status, tone: 'amber' as const };

/** An invoice's status, in words. */
export const INVOICE_STATUS: Record<string, string> = {
  draft: 'In review', approved: 'Approved', charged: 'Charged', sent: 'Invoice sent', paid: 'Paid', failed: 'Payment failed', void: 'Void',
};
export const invoiceStatus = (status: string) => INVOICE_STATUS[status] ?? status;

export const PRICING_LABEL: Record<string, string> = { per_push: 'Per push', per_inch_tier: 'Per inch tiers', per_event: 'Per event', seasonal: 'Seasonal', hourly: 'Hourly' };
export const pricingLabel = (type: string) => PRICING_LABEL[type] ?? type.replace(/_/g, ' ');

/** The message log's columns, as a person reads them. */
export const MESSAGE_LABEL: Record<string, string> = {
  call_out: 'Call-out', completion_report: 'Service record', crew_invite: 'Crew invite', crew_link: 'Driver link', done: 'Lot done', done_no_photo: 'Lot done',
  invoice: 'Invoice', bill: 'Bill', late: 'Running late', on_the_way: 'On the way', owner_alert: 'Owner alert', portal: 'Records link', quote: 'Quote',
  receipt: 'Receipt', route_changed: 'Route changed', salt_supplier: 'Salt order', team_invite: 'Team invite',
};
export const messageLabel = (template: string) => MESSAGE_LABEL[template] ?? template.replace(/_/g, ' ');
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', sms: 'Text', push: 'Push' };
export const MESSAGE_STATUS: Record<string, string> = {
  sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', gone: 'Phone unsubscribed',
  not_sent: 'Not sent: email is off', rejected: 'Rejected: address not valid',
  blocked: 'Not sent: sending is not on yet',
};
export const messageStatus = (status: string | null) => (status ? MESSAGE_STATUS[status] ?? status.replace(/_/g, ' ') : '');

/** A background job, named by what it does. */
export const JOB_LABEL: Record<string, string> = {
  'billing.charge': 'Charge a customer', 'billing.installments': 'Bill seasonal installments', 'billing.redraft': 'Redo a storm\'s bills',
  'qbo.push': 'Send a bill to QuickBooks', 'qbo.payment': 'Post a payment to QuickBooks', 'qbo.poll': 'Check QuickBooks for payments',
  'notify.customer': 'Customer message', 'notify.invoice_sms': 'Invoice text', 'notify.party': 'Message', 'notify.push': 'Phone alert',
  'notify.route_changed': 'Route change text', 'notify.visit_done': 'Lot done message', 'photo.process': 'Process a photo',
  'proof.render': 'Build a proof packet', 'report.completion': 'Service record email', 'salt.supplier_email': 'Salt order email',
  'sms.mock_approve': 'Texting approval (test)', 'sms.tollfree_submit': 'Texting number request', 'storm.publish_links': 'Send driver links',
  'trigger.evaluate': 'Check snow triggers', 'weather.fetch_alerts': 'Weather alerts', 'weather.fetch_cell': 'Forecast update', 'weather.nohrsc': 'Snowfall report', 'weather.nbm': 'Blend of models forecast', 'weather.nowcast': 'Hourly storm forecast (HRRR)', 'weather.radar': 'Radar precipitation',
};
export const jobLabel = (kind: string) => JOB_LABEL[kind] ?? kind.replace(/[._]/g, ' ');

/** A stored "06:00" or "17:30" as people read it: "6:00 AM", "5:30 PM". Anything else is shown as it is. */
export function clock12(hm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '');
  if (!m) return hm ?? '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * A stop's status: the word on its badge, the badge tone, and the map pin color, from one place so a color means the same
 * thing on the board and on the map (issue 191). Pin colors are the solid version of each badge's hue.
 */
export const STOP_STATUS: Record<string, { word: string; tone: 'gray' | 'blue' | 'green' | 'amber' | 'red'; color: string }> = {
  open: { word: 'Open', tone: 'gray', color: '#475569' },
  enroute: { word: 'On the way', tone: 'blue', color: '#0284c7' },
  onsite: { word: 'On site', tone: 'amber', color: '#d97706' },
  done: { word: 'Done', tone: 'green', color: '#059669' },
  skipped: { word: 'Skipped', tone: 'gray', color: '#a8b3c2' },
  problem: { word: 'Problem', tone: 'red', color: '#dc2626' },
};
/** The driver's last reported spot on the map. */
export const DRIVER_PIN = '#7c3aed';
/** One color per truck, for its lane edge and its pins' rings. */
export const TRUCK_COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#0891b2', '#ca8a04', '#4f46e5', '#be123c'];
