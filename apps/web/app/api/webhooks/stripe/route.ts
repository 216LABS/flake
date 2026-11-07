import { handleStripeEvent } from '@/lib/billing';
import { HttpError, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/** Verifies the signature on the raw body, then dedupes on the event id. */
export const POST = route(async (req) => {
  const raw = await req.text();
  const { payments } = await getProviders();
  let event;
  try {
    event = payments.verifyWebhook(raw, req.headers.get('stripe-signature'));
  } catch {
    throw new HttpError(400, 'Invalid signature');
  }
  return { received: true, result: await handleStripeEvent(event) };
});
