import { certState, subCoverage, type CertState, type SubCoverage } from '@flake/core/compliance';
import { localDay } from '@flake/core/receivables';
import { and, asc, certificate, claim, crew_member, customer, desc, eq, proof_packet, site, type Tx } from '@flake/db';

export type CertRow = typeof certificate.$inferSelect & { state: CertState };

/** Certificates, each sub's cover, and claims with the packets that could go with them (issue 165). */
export async function complianceOverview(tx: Tx, tz: string) {
  const today = localDay(new Date(), tz);
  const certs: CertRow[] = (await tx.select().from(certificate).orderBy(desc(certificate.expires_on))).map((c) => ({ ...c, state: certState(c.expires_on, today) }));
  const subs = await tx.select({ id: crew_member.id, name: crew_member.name }).from(crew_member).where(and(eq(crew_member.kind, 'sub'), eq(crew_member.active, true))).orderBy(asc(crew_member.name));
  const claims = await tx.select({ c: claim, label: site.label, customer: customer.name }).from(claim).innerJoin(site, eq(site.id, claim.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).orderBy(desc(claim.incident_at));
  const packets = await tx.select({ id: proof_packet.id, site_id: proof_packet.site_id, from_ts: proof_packet.from_ts, to_ts: proof_packet.to_ts, created_at: proof_packet.created_at }).from(proof_packet).orderBy(desc(proof_packet.created_at)).limit(200);
  return {
    today,
    company: certs.filter((c) => !c.crew_id),
    subs: subs.map((s) => {
      const mine = certs.filter((c) => c.crew_id === s.id);
      return { ...s, coverage: subCoverage(mine, today), certs: mine };
    }),
    claims: claims.map(({ c, label, customer: who }) => ({
      ...c, label, customer: who,
      // Packets for this lot whose window covers the incident.
      candidates: packets.filter((p) => p.site_id === c.site_id && Date.parse(p.from_ts) <= Date.parse(c.incident_at) && Date.parse(p.to_ts) >= Date.parse(c.incident_at)),
    })),
  };
}

/** What the dashboard warns about: company certificates ending soon or ended, and subs without current cover. */
export async function complianceAlerts(tx: Tx, tz: string): Promise<{ text: string; tone: 'red' | 'amber' }[]> {
  const o = await complianceOverview(tx, tz);
  const out: { text: string; tone: 'red' | 'amber' }[] = [];
  for (const c of o.company) {
    if (c.state === 'expired') out.push({ tone: 'red', text: `Your ${c.insurer ?? ''} certificate ended ${c.expires_on}.`.replace('  ', ' ') });
    if (c.state === 'expiring') out.push({ tone: 'amber', text: `Your ${c.insurer ?? ''} certificate ends ${c.expires_on}.`.replace('  ', ' ') });
  }
  const word: Record<SubCoverage, string> = { covered: '', expiring: 'insurance ends within 30 days', expired: 'insurance has ended', missing: 'has no certificate of insurance on file' };
  for (const s of o.subs) if (s.coverage !== 'covered') out.push({ tone: s.coverage === 'expiring' ? 'amber' : 'red', text: `${s.name}: ${word[s.coverage]}.` });
  return out;
}
