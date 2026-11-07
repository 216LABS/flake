import { contract, customer, desc, eq, inArray, site } from '@flake/db';
import { Badge, Card, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';

export const metadata = { title: 'Customer' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, id));
    if (!c) return null;
    const sites = await tx.select().from(site).where(eq(site.customer_id, id));
    const contracts = sites.length ? await tx.select().from(contract).where(inArray(contract.site_id, sites.map((s) => s.id))).orderBy(desc(contract.created_at)) : [];
    return { c, sites, contracts };
  });
  if (!data) notFound();
  const { c, sites, contracts } = data;
  return (
    <>
      <PageHeader title={c.name} subtitle={c.kind} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Contact</h2>
          <p className="mt-1 text-sm">{c.contact_name ?? 'No contact name'}</p>
          <p className="text-sm">{c.email ?? 'No email'}</p>
          <p className="text-sm">{c.phone_e164 ?? 'No phone'}</p>
          <p className="mt-2 text-sm">Texts: {c.notify_sms ? 'yes' : 'no'}. Emails: {c.notify_email ? 'yes' : 'no'}.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Billing</h2>
          <p className="mt-1 text-sm">{c.billing_mode.replace(/_/g, ' ')}</p>
          <p className="text-sm">Payment on file: {c.stripe_payment_method_id ? 'yes' : 'no'}</p>
        </Card>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Sites</h2>
      <Table>
        <thead><tr><Th>Site</Th><Th>Address</Th><Th>Area</Th><Th>Contract</Th></tr></thead>
        <tbody>
          {sites.map((s) => {
            const k = contracts.find((x) => x.site_id === s.id);
            return (
              <tr key={s.id}>
                <Td><Link className="text-sky-800 underline" href={`/sites/${s.id}`}>{s.label}</Link></Td>
                <Td>{s.address}</Td>
                <Td>{s.area_confirmed_sqft ? `${Number(s.area_confirmed_sqft).toLocaleString()} sq ft` : s.area_estimate_sqft ? `~${Number(s.area_estimate_sqft).toLocaleString()} sq ft` : 'unavailable'}</Td>
                <Td><Badge tone={k?.status === 'accepted' ? 'green' : 'amber'}>{k?.status ?? 'none'}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
