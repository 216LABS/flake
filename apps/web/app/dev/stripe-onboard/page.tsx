import { MockStripe } from './mock-stripe';

export default async function Page({ searchParams }: { searchParams: Promise<{ account?: string; pro?: string }> }) {
  const sp = await searchParams;
  return <MockStripe account={sp.account} pro={Boolean(sp.pro)} />;
}
