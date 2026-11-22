import type { MemberRole } from '@flake/db';

/**
 * Finer roles (issue 227). The three original roles are unchanged. A branch manager has dispatcher powers inside their
 * branches (the database's branch policies do the limiting). Billing staff read everything but change only billing,
 * receivables and exports. A field lead runs the storm board and never sees money. Checked once per request, by path,
 * in requireApi and requirePage, so a route added later is closed to these roles until it's listed here.
 */
export type Role = 'owner' | 'dispatcher' | 'viewer';

/** The original rank each role acts with. */
export const RANK_OF: Record<MemberRole, Role> = { owner: 'owner', dispatcher: 'dispatcher', viewer: 'viewer', branch_manager: 'dispatcher', billing: 'dispatcher', field_lead: 'dispatcher' };

export const ROLE_WORD: Record<MemberRole, string> = { owner: 'Owner', dispatcher: 'Dispatcher', viewer: 'View only', branch_manager: 'Branch manager', billing: 'Billing', field_lead: 'Field lead' };
export const ROLE_HELP: Record<MemberRole, string> = {
  owner: 'Everything, including company settings and plans.',
  dispatcher: 'Storms, routes, customers and billing.',
  viewer: 'Sees everything, changes nothing.',
  branch_manager: 'Dispatcher powers for the branches you pick, and nothing outside them.',
  billing: 'Billing review, receivables and exports. Can look at storms but not run them.',
  field_lead: 'Runs the storm board. Sees no prices, bills or pay.',
};

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

// Field leads: these pages and APIs only.
export const FIELD_PAGES = ['/dashboard', '/storms', '/alerts', '/help', '/routes'];
const FIELD_APIS = ['/api/storms', '/api/runs', '/api/run-stops', '/api/alerts', '/api/push', '/api/feedback', '/api/sites/suggest', '/api/lots'];
// Billing: any page and any read; changes only here.
const BILLING_WRITES = ['/api/billing', '/api/receivables', '/api/insurance', '/api/season', '/api/share', '/api/customers', '/api/proof', '/api/integrations/qbo', '/api/settings/export', '/api/push', '/api/feedback'];

/** Whether this member role may use this page or API. The original three always may; their ranks are checked as before. */
export function roleAllows(role: MemberRole, path: string | null, method = 'GET'): boolean {
  if (!path || role === 'owner' || role === 'dispatcher' || role === 'viewer' || role === 'branch_manager') return true;
  const api = path.startsWith('/api/');
  if (role === 'field_lead') return api ? under(path, FIELD_APIS) : under(path, FIELD_PAGES);
  // billing
  if (!api || method === 'GET' || method === 'HEAD') return true;
  return under(path, BILLING_WRITES);
}

/** Money on screen (prices, bills, pay, owed): everyone but a field lead. */
export const seesMoney = (role: MemberRole) => role !== 'field_lead';
