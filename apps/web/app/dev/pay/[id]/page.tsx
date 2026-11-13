import { Card } from '@flake/ui';

export default async function MockPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Card className="max-w-md" data-testid="mock-pay">
      <h1 className="text-lg font-semibold">Mock hosted payment page</h1>
      <p className="mt-1 text-sm text-muted">In production this is Stripe&apos;s hosted page. Reference {id}.</p>
    </Card>
  );
}
