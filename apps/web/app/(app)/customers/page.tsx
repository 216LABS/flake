import { customer, desc, site } from '@flake/db';
import { Badge, buttonVariants, EmptyState, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';

export const metadata = { title: 'Customers' };

export default async function Customers({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === '1';
  const ctx = await requirePage();
  const { customers: all, sites } = await asUser(ctx, async (tx) => ({ customers: await tx.select().from(customer).orderBy(desc(customer.created_at)), sites: await tx.select().from(site) }));
  const archived = all.filter((c) => c.archived_at);
  const customers = showArchived ? archived : all.filter((c) => !c.archived_at);
  return (
    <>
      <PageHeader title={showArchived ? 'Archived customers' : 'Customers'} actions={ctx.role !== 'viewer' && !showArchived ? <Link href="/customers/new" className={buttonVariants({ variant: 'accent' })} data-testid="new-customer">New customer</Link> : null} />
      {customers.length ? (
        <Table>
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Sites</Th><Th>Billing</Th><Th>Payment on file</Th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-semibold text-slate-950 underline-offset-2 hover:underline" href={`/customers/${c.id}`}>{c.name}</Link></Td>
                <Td><Badge>{c.kind}</Badge></Td>
                <Td>{sites.filter((s) => s.customer_id === c.id && s.active).length}</Td>
                <Td>{c.billing_mode.replace(/_/g, ' ')}</Td>
                <Td>{c.stripe_payment_method_id ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : showArchived ? <EmptyState title="No archived customers" /> : <EmptyState title="No customers yet" body="Most operators add one in a few minutes." action={<Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add your first customer</Link>} />}
      {showArchived ? <Link className="mt-4 inline-block text-sm text-sky-800 underline" href="/customers">Back to customers</Link>
        : archived.length ? <Link className="mt-4 inline-block text-sm text-sky-800 underline" href="/customers?archived=1" data-testid="show-archived">Archived customers ({archived.length})</Link> : null}
    </>
  );
}
