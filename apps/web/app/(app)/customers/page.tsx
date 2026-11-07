import { customer, desc, site } from '@flake/db';
import { Badge, buttonVariants, EmptyState, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';

export const metadata = { title: 'Customers' };

export default async function Customers() {
  const ctx = await requirePage();
  const { customers, sites } = await asUser(ctx, async (tx) => ({ customers: await tx.select().from(customer).orderBy(desc(customer.created_at)), sites: await tx.select().from(site) }));
  return (
    <>
      <PageHeader title="Customers" actions={<Link href="/customers/new" className={buttonVariants({ variant: 'accent' })} data-testid="new-customer">New customer</Link>} />
      {customers.length ? (
        <Table>
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Sites</Th><Th>Billing</Th><Th>Payment on file</Th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-medium text-sky-800 underline" href={`/customers/${c.id}`}>{c.name}</Link></Td>
                <Td><Badge>{c.kind}</Badge></Td>
                <Td>{sites.filter((s) => s.customer_id === c.id).length}</Td>
                <Td>{c.billing_mode.replace(/_/g, ' ')}</Td>
                <Td>{c.stripe_payment_method_id ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No customers yet" body="Most operators add one in a few minutes." action={<Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add your first customer</Link>} />}
    </>
  );
}
