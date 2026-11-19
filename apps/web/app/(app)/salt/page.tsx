import { PageHeader } from '@flake/ui';
import Link from 'next/link';
import { requirePage } from '@/lib/auth';
import { yardStock } from '@/lib/yards';
import { YardsPanel } from './yards-panel';

export const metadata = { title: 'Salt yards' };

/** Salt on hand at each yard, what it cost, and reorder points (issue 169). */
export default async function SaltYards() {
  const ctx = await requirePage();
  const yards = await yardStock(ctx.tenantId);
  return (
    <>
      <PageHeader title="Salt yards" subtitle="On hand = the last count, plus deliveries and adjustments since, minus what drivers logged on lots since. Bags count as 50 lb." />
      <YardsPanel yards={JSON.parse(JSON.stringify(yards))} tz={ctx.tenant.timezone} readOnly={ctx.role === 'viewer'} />
      <p className="mt-4 text-sm"><Link className="text-link underline" href="/reports">Order salt, and salt use by storm, in Reports</Link></p>
    </>
  );
}
