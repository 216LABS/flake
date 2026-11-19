/**
 * Insurance certificates (issue 165). Decisions (Nov 19):
 * - Alerts start 30 days before a certificate ends. Expired or expiring ones show on the dashboard; nothing is emailed.
 * - A sub needs one certificate of insurance on file (any coverage but a W-9). Missing or expired is flagged on the crew
 *   list and the dashboard, and only warned about, never blocked: the owner decides who plows.
 * - A W-9 is kept on file and never sent to customers.
 */

export const EXPIRING_DAYS = 30;

export type CertState = 'ok' | 'expiring' | 'expired' | 'no_end';

export function certState(expiresOn: string | null, today: string): CertState {
  if (!expiresOn) return 'no_end';
  const days = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return 'expired';
  return days <= EXPIRING_DAYS ? 'expiring' : 'ok';
}

export type SubCoverage = 'covered' | 'expiring' | 'expired' | 'missing';

/** Where a sub stands, from their certificates: the best certificate of insurance they have on file wins. */
export function subCoverage(certs: { kind: string; expires_on: string | null }[], today: string): SubCoverage {
  const coi = certs.filter((c) => c.kind !== 'w9');
  if (!coi.length) return 'missing';
  const states = coi.map((c) => certState(c.expires_on, today));
  if (states.includes('ok') || states.includes('no_end')) return 'covered';
  if (states.includes('expiring')) return 'expiring';
  return 'expired';
}

export const CERT_KIND_LABEL: Record<string, string> = {
  general_liability: 'General liability', auto: 'Auto', workers_comp: "Workers' comp", umbrella: 'Umbrella', w9: 'W-9', other: 'Other',
};
