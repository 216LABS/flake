import { fmtLocal } from '@flake/core/time';
import type { RenewalPack } from './renewal-pack';

/** The renewal pack's PDF (issue 236), in plain words an underwriter reads. */
export async function renewalPdf(p: RenewalPack, tz: string): Promise<Buffer> {
  const { renderRenewalPackPdf } = await import('@flake/providers/pdf');
  const pctText = (v: number | null) => (v == null ? 'no visits' : `${v}%`);
  return renderRenewalPackPdf({
    company: p.company, from: p.from, to: p.to, generatedAt: fmtLocal(new Date(), tz, { month: 'short', day: 'numeric', year: 'numeric' }),
    facts: [
      ['Storms worked', String(p.storms)], ['Visits recorded', String(p.visits)],
      ['Visits with GPS at arrival', pctText(p.pct_gps)], ['Visits with before and after photos', pctText(p.pct_photos)], ['Visits with snow depth measured', pctText(p.pct_depth)],
      ['Salt applied', `${p.salt_tons} tons`], ['Salt and refreeze runs alerted', String(p.salt_runs)],
      ['Average time from snow alert to first truck on a lot', p.avg_response_min == null ? 'no alert-started storms' : `${p.avg_response_min} minutes`],
    ],
    sites: p.sites,
    coi: p.coi ? [p.coi.insurer, p.coi.policy_number && `policy ${p.coi.policy_number}`, p.coi.expires_on && `through ${p.coi.expires_on}`].filter(Boolean).join(', ') || null : null,
    claims: p.claims.length ? p.claims.map((c) => `${c.n} ${c.status}`).join(', ') : 'none',
  });
}
