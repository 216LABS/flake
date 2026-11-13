import { subPayStatement, type SubRateCard } from '@flake/core/subpay';
import { fmtLocal } from '@flake/core/time';
import { asc, crew_member, eq, inArray, site, storm, visit, visit_correction } from '@flake/db';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@flake/ui';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { tenantHasPro } from '@/lib/billing';

export const metadata = { title: 'Sub pay statements' };
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function SubPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => {
    const [s] = await tx.select().from(storm).where(eq(storm.id, id));
    if (!s) return null;
    const visits = await tx.select({ visit, site, crew: crew_member }).from(visit).innerJoin(site, eq(site.id, visit.site_id)).innerJoin(crew_member, eq(crew_member.id, visit.crew_id)).where(eq(visit.storm_id, id));
    const ids = visits.map((v) => v.visit.id);
    const corrections = ids.length ? await tx.select().from(visit_correction).where(inArray(visit_correction.visit_id, ids)).orderBy(asc(visit_correction.created_at)) : [];
    return { s, visits, corrections };
  });
  if (!data) notFound();
  if (!tenantHasPro(ctx.tenant)) return <EmptyState title="Sub pay statements are a Pro feature" body="Upgrade in Settings, Plan." />;
  const subs = new Map<string, { crew: (typeof data.visits)[number]['crew']; rows: (typeof data.visits)[number][] }>();
  // Corrections count here too: an undone visit isn't paid, and a corrected salt quantity is what's paid on.
  const voided = new Set(data.corrections.filter((c) => c.field === 'voided' && c.new_value === true).map((c) => c.visit_id));
  const saltOf = (id: string, recorded: { unit: string; qty: number }[] | null) => (data.corrections.filter((c) => c.visit_id === id && c.field === 'salt').at(-1)?.new_value as { unit: string; qty: number }[] | undefined) ?? recorded;
  for (const v of data.visits) {
    if (v.crew.kind !== 'sub' || voided.has(v.visit.id)) continue;
    const e = subs.get(v.crew.id) ?? { crew: v.crew, rows: [] };
    e.rows.push(v);
    subs.set(v.crew.id, e);
  }
  return (
    <>
      <PageHeader title={`Sub pay: ${data.s.name}`} subtitle={fmtLocal(data.s.started_at, ctx.tenant.timezone)} />
      {!subs.size ? <EmptyState title="No subcontractor visits in this storm" /> : null}
      <div className="space-y-4">
        {[...subs.values()].map(({ crew, rows }) => {
          const st = subPayStatement(crew.sub_rate_card as SubRateCard | null, rows.map((r) => ({ id: r.visit.id, site_label: r.site.label, arrived_at: r.visit.arrived_device_at, departed_at: r.visit.departed_device_at, salt: saltOf(r.visit.id, r.visit.salt) })));
          return (
            <Card key={crew.id} data-testid="sub-statement">
              <h2 className="mb-2 font-semibold">{crew.name}: {money(st.total_cents)}</h2>
              {!crew.sub_rate_card ? <p className="mb-2 text-sm text-warn-ink">No rate card for this sub, so amounts are $0. Add one in Settings, Crew.</p> : null}
              <Table>
                <thead><tr><Th>Visit</Th><Th>Amount</Th></tr></thead>
                <tbody>{st.lines.map((l) => <tr key={l.visit_id} data-testid={l.check ? 'sub-check' : undefined}><Td>{l.description}{l.check ? <div className="mt-0.5 text-xs font-medium text-warn-ink">{l.check}</div> : null}</Td><Td>{money(l.amount_cents)}</Td></tr>)}</tbody>
              </Table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
