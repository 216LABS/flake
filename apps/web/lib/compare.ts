/**
 * The /compare grid (issue 181). Every competitor cell comes from that vendor's own public pages, listed in SOURCES,
 * as of November 2026. Unverified means we couldn't confirm it either way: it is never shown as a check, and it is
 * never turned into a No to make Flake look better. A price or cell fix is a change here, not in the page.
 */
export type CellValue = 'yes' | 'no' | 'partial' | 'addon' | 'unverified';
export interface Cell { v: CellValue; note?: string }
export const PRODUCTS = ['Flake', 'Jobber', 'Yeti', 'Service Autopilot', 'Plowdesk'] as const;
export type Product = (typeof PRODUCTS)[number];
export interface Row { feature: string; cells: Record<Product, Cell> }

const y = (note?: string): Cell => ({ v: 'yes', note });
const n = (note?: string): Cell => ({ v: 'no', note });
const p = (note?: string): Cell => ({ v: 'partial', note });
const a = (note?: string): Cell => ({ v: 'addon', note });
const u = (note?: string): Cell => ({ v: 'unverified', note });

export const LABEL: Record<CellValue, string> = { yes: 'Yes', no: 'No', partial: 'Partial', addon: 'Add-on', unverified: 'Unverified' };

export const ROWS: Row[] = [
  { feature: 'Built specifically for snow operations', cells: {
    Flake: y(), Jobber: n('General field-service software with a snow visit workflow'), Yeti: y(), 'Service Autopilot': p('Lawn, landscape and snow; snow dispatch from Pro'), Plowdesk: y() } },
  { feature: 'Weather alerts when a contract\'s trigger depth is forecast or reached', cells: {
    Flake: y('National Weather Service data. The owner starts the storm; it never dispatches by itself.'), Jobber: n('Official snow workflow: create visits when it snows'), Yeti: u('Weather reporting is an add-on; trigger-depth alerts not confirmed'), 'Service Autopilot': u('Mentions adjusting jobs as the forecast changes, not trigger-depth alerts'), Plowdesk: u('Weather integrations are on Contractor; trigger-depth alerts not confirmed') } },
  { feature: 'Forecast and weather evidence archived with the visit record', cells: {
    Flake: y('Archived with a hash'), Jobber: u(), Yeti: u(), 'Service Autopilot': u(), Plowdesk: u() } },
  { feature: 'One-tap storm from saved master routes', cells: {
    Flake: y(), Jobber: p('Bulk "create new visits" on recurring jobs, up to 100 at a time'), Yeti: y('Plan routes once, dispatch from a live hub'), 'Service Autopilot': y('From Pro: master routes and Snow Dispatch'), Plowdesk: y('Storm route templates; free plan up to 3 storm routes') } },
  { feature: 'Driver check-in with no app to install', cells: {
    Flake: y('A link that opens in the phone\'s browser'), Jobber: n('Requires the Jobber app'), Yeti: n('Requires the Yeti app'), 'Service Autopilot': n('Requires the Service Autopilot app'), Plowdesk: n('Requires the iPhone/iPad or Android app') } },
  { feature: 'Works with no cell signal, then syncs', cells: {
    Flake: y(), Jobber: u(), Yeti: u(), 'Service Autopilot': u(), Plowdesk: y('In the mobile app') } },
  { feature: 'Spanish for drivers', cells: {
    Flake: y(), Jobber: y('For select team members in the app'), Yeti: y('English, French and Spanish'), 'Service Autopilot': u(), Plowdesk: u() } },
  { feature: 'Photos, time and GPS on each visit', cells: {
    Flake: y('Plus reported depth and salt'), Jobber: p('Photos and notes; GPS through fleet partners'), Yeti: y('Required photos, GPS verification, geofencing'), 'Service Autopilot': p('Photos and timestamps; live GPS is a priced extra'), Plowdesk: y('Photos, GPS and route history, time on site') } },
  { feature: 'One-click proof or incident packet for a claim', cells: {
    Flake: y('Times, GPS, photos, salt, weather and contract in one PDF'), Jobber: u(), Yeti: y('GPS, photos, audit trail and inspections for slip-and-fall records'), 'Service Autopilot': u('Photos and timestamps are advertised'), Plowdesk: p('Records support insurance documentation; a packaged PDF is not confirmed') } },
  { feature: 'Customer "on the way" and "done" updates', cells: {
    Flake: y('Done can include a photo'), Jobber: y('On-my-way texts and follow-ups'), Yeti: y('Arrival and completion notifications'), 'Service Autopilot': p('Two-way texting is Elite or call for pricing'), Plowdesk: p('Manual on the free plan; automated on Contractor') } },
  { feature: 'Customer portal with service history', cells: {
    Flake: y(), Jobber: y('Client Hub'), Yeti: u('Service history is advertised; a portal is not confirmed'), 'Service Autopilot': a('Call for pricing; included on Elite'), Plowdesk: p('Being tested this plow season') } },
  { feature: 'Quotes and contracts', cells: {
    Flake: y('Plus a next-season renewal queue'), Jobber: y(), Yeti: y(), 'Service Autopilot': y(), Plowdesk: y() } },
  { feature: 'Quote from a measured lot size', cells: {
    Flake: y('Area estimated from parcel and map data'), Jobber: u(), Yeti: p('Site maps with measurements; quote from area not confirmed'), 'Service Autopilot': a('Smart Maps is call for pricing'), Plowdesk: u('Property-data integrations are on Contractor') } },
  { feature: 'Per-push billing', cells: {
    Flake: y(), Jobber: y('Per visit'), Yeti: y('Per visit'), 'Service Autopilot': y(), Plowdesk: y() } },
  { feature: 'Per-inch tier billing', cells: {
    Flake: y('Built-in depth tiers'), Jobber: p('Workaround: a separate job per depth band'), Yeti: n('Not among its listed charge types'), 'Service Autopilot': y(), Plowdesk: y('Tiered per-inch pricing') } },
  { feature: 'Per-event billing', cells: {
    Flake: y(), Jobber: u(), Yeti: u(), 'Service Autopilot': y(), Plowdesk: y() } },
  { feature: 'Seasonal contracts with installments', cells: {
    Flake: y('Split into 1 to 12 installments'), Jobber: p('Fixed price with a monthly or custom invoice schedule'), Yeti: p('A recurring monthly rate'), 'Service Autopilot': p('Flat-rate billing; installments not confirmed'), Plowdesk: p('Payment schedules on quotes') } },
  { feature: 'Hourly billing', cells: {
    Flake: y(), Jobber: u(), Yeti: y('Hourly service and equipment'), 'Service Autopilot': y(), Plowdesk: y() } },
  { feature: 'Invoices built from the visit log after the storm', cells: {
    Flake: y('Flagged items to review, then approve'), Jobber: p('From visits you created first'), Yeti: y('Batch invoicing'), 'Service Autopilot': y('Bulk invoicing'), Plowdesk: y('Invoice schedules on paid features') } },
  { feature: 'Online card and bank payments', cells: {
    Flake: y('Manual billing has no Flake fee'), Jobber: y('Jobber Payments'), Yeti: u(), 'Service Autopilot': y(), Plowdesk: p('Venmo tracking free; payment integrations on Contractor') } },
  { feature: 'QuickBooks', cells: {
    Flake: y('CSV export'), Jobber: y('One-way QuickBooks Online sync, Connect plan and up'), Yeti: y('QuickBooks Online integration'), 'Service Autopilot': a('Two-way QuickBooks Online; call for pricing below Elite'), Plowdesk: y('Manual CSV export only, no sync') } },
  { feature: 'Payroll file for Gusto or ADP', cells: {
    Flake: y('Gusto file and ADP file'), Jobber: p('Gusto timesheets; ADP not confirmed'), Yeti: n('Custom API only'), 'Service Autopilot': u(), Plowdesk: u() } },
  { feature: 'Salt and material tracking', cells: {
    Flake: y('Used on each visit, plus on-hand stock'), Jobber: u(), Yeti: p('Consumables billed; yard stock not confirmed'), 'Service Autopilot': p('Chemical tracking from Pro'), Plowdesk: p('Materials on quotes') } },
  { feature: 'Profit per lot or job costing', cells: {
    Flake: y(), Jobber: y('Grow plan and up'), Yeti: y('Job costing reports'), 'Service Autopilot': y('From Pro'), Plowdesk: u() } },
  { feature: 'Subcontractor pay statements', cells: {
    Flake: y(), Jobber: u(), Yeti: y('Sub rates and payables'), 'Service Autopilot': u(), Plowdesk: u() } },
  { feature: 'Crew and customer spreadsheet import', cells: {
    Flake: y(), Jobber: u('Client import from QuickBooks Online is documented'), Yeti: u(), 'Service Autopilot': u(), Plowdesk: p('Customers by CSV or QuickBooks import; crew import not confirmed') } },
  { feature: 'Self-serve sign-up and setup', cells: {
    Flake: y(), Jobber: y('14-day trial, no card'), Yeti: y('Public sign-up'), 'Service Autopilot': p('Startup has a sign-up path; higher plans push a demo'), Plowdesk: y('Free plan, no card') } },
];

/** Published entry prices, in the vendor's own terms. Shown as the grid's last row and in the recap. */
export const PRICES: Record<Product, string> = {
  Flake: 'Free for the 2026-27 season',
  Jobber: 'Core $29/mo billed annually ($49 month to month) for 1 user; extra users $29/mo. Connect from $99/mo, Grow from $149/mo, Plus from $399/mo, billed annually.',
  Yeti: 'High Performance $66.50/mo billed annually ($798/year) for 1 to 25 sites, unlimited users. Weather reporting is an add-on.',
  'Service Autopilot': 'Startup $49/mo, Pro Plus $499/mo, annual subscription, each plus a sign-up fee. Snow Dispatch starts at Pro.',
  Plowdesk: 'Operator free (up to 3 storm routes). Contractor $95/mo.',
};

export const SOURCES: { product: Product; links: [string, string][] }[] = [
  { product: 'Flake', links: [['Free season', '/free-season'], ['Home', '/']] },
  { product: 'Jobber', links: [
    ['Snow removal', 'https://www.getjobber.com/industries/snow-removal/'],
    ['Pricing', 'https://www.getjobber.com/pricing/'],
    ['Snow removal workflow', 'https://help.getjobber.com/en/articles/create-new-visits-for-existing-recurring-jobs-snow-removal-workflow-new-schedule/'],
    ['QuickBooks sync', 'https://www.getjobber.com/features/quickbooks-sync/'],
    ['Gusto integration', 'https://help.getjobber.com/en/articles/jobber-and-gusto-integration/'],
  ] },
  { product: 'Yeti', links: [
    ['Platform', 'https://yetisoftware.com/platform'],
    ['Pricing', 'https://yetisoftware.com/pricing'],
    ['Charge types', 'https://support.yetisoftware.com/how-to-set-rates-for-clients-and-sub-contractors'],
    ['Payroll', 'https://support.yetisoftware.com/does-yeti-integrate-with-payroll-softwares'],
  ] },
  { product: 'Service Autopilot', links: [
    ['Snow removal', 'https://serviceautopilot.com/snow-removal-software'],
    ['Pricing', 'https://serviceautopilot.com/pricing'],
    ['Snow events', 'https://support.serviceautopilot.com/s/article/Create-a-Snow-Event-1730407283408'],
  ] },
  { product: 'Plowdesk', links: [['Product and plans', 'https://www.plowdesk.com/'], ['FAQ', 'https://www.plowdesk.com/faq']] },
];

export const AS_OF = 'As of November 2026, based on public information. Features, plan limits, and prices change; confirm with each vendor.';
