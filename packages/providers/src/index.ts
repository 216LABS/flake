import { LiveEmail } from './live/email';
import { LiveFootprints, LiveGeocoder, LiveOsm, LiveParcels, LiveTiles } from './live/geo';
import { LivePayments } from './live/payments';
import { LiveSms } from './live/sms';
import { LivePush, MockPush, noPush } from './live/push';
import { LiveWeather } from './live/weather';
import { MockEmail } from './mock/email';
import { MockFootprints, MockGeocoder, MockOsm, MockParcels, MockTiles } from './mock/geo';
import { MockPayments } from './mock/payments';
import { MockSms } from './mock/sms';
import { MockWeather, type WeatherFixtureName } from './mock/weather';
import { MockRouteMatrix } from './mock/router';
import { LiveRouteMatrix, noRouter } from './live/router';
import type { EmailProvider, PaymentsProvider, Providers, SmsProvider } from './types';

export * from './types';
export { MockWeather, WEATHER_FIXTURES, type WeatherFixtureName } from './mock/weather';
export { MockEmail, MOCK_REJECTED_DOMAIN } from './mock/email';
export { MockRouteMatrix } from './mock/router';
export { LiveRouteMatrix, noRouter } from './live/router';
export { MockPayments, signMockWebhook, MOCK_WEBHOOK_SECRET } from './mock/payments';
export { MockSms, signTwilio, MOCK_TWILIO_TOKEN } from './mock/sms';
export { MockFootprints, MockGeocoder, MockOsm, MockParcels, MockTiles } from './mock/geo';
export { LiveWeather, nearestValidCell, nohrscCellToInches, nohrscUrl } from './live/weather';
export { LivePush, MockPush } from './live/push';
export { LiveEmail } from './live/email';
export { LiveSms } from './live/sms';
export { LivePayments } from './live/payments';
export { LiveFootprints, LiveGeocoder, LiveOsm, LiveParcels, LiveTiles, countyParcels } from './live/geo';

/**
 * Production with a missing key must refuse, never fall back to a mock: the mock "succeeds" charges and its
 * webhook secret and token are public in this repo. Only Stripe's and Twilio's own signatures are ever accepted.
 */
const refuse = (name: string) => async () => {
  throw new Error(`${name} is not configured`);
};
const unconfiguredSms = (): SmsProvider => ({ send: refuse('Twilio'), provisionTenant: refuse('Twilio'), submitTollFreeVerification: refuse('Twilio'), verifyWebhook: () => false });
/** Sign-in email is Supabase's, so running without this is a supported way to test. The log says not_sent. */
const noEmail = (): EmailProvider => ({ send: async () => ({ id: 'none', status: 'not_sent' }) });
const unconfiguredPayments = (): PaymentsProvider => ({
  isMock: false,
  createConnectedAccount: refuse('Stripe'),
  createAccountLink: refuse('Stripe'),
  ensureCustomer: refuse('Stripe'),
  createSetupIntent: refuse('Stripe'),
  chargeOffSession: refuse('Stripe'),
  createPayLink: refuse('Stripe'),
  createInvoice: refuse('Stripe'),
  createProCheckout: refuse('Stripe'),
  verifyWebhook: () => {
    throw new Error('Stripe is not configured');
  },
});

export interface ProviderOptions {
  mode: 'mock' | 'live';
  appEnv: string;
  env: Record<string, string | undefined>;
  baseUrl: string;
  weatherFixture?: WeatherFixtureName;
}

/**
 * Every third party is chosen here. APP_ENV != production hard-blocks real SMS and live Stripe charges
 * even when live keys are present (ADDENDUM_DEVOPS section 1).
 */
export function createProviders(opts: ProviderOptions): Providers {
  const { mode, appEnv, env, baseUrl } = opts;
  if (mode === 'mock' && appEnv === 'production') throw new Error('PROVIDERS_MODE=mock is not allowed in production');
  if (mode === 'mock') {
    return {
      mode,
      router: new MockRouteMatrix(),
      push: new MockPush(),
      weather: new MockWeather(opts.weatherFixture ?? 'lakewood-lake-effect-2025-12'),
      parcel: new MockParcels(),
      footprints: new MockFootprints(),
      osm: new MockOsm(),
      geocoder: new MockGeocoder(),
      tiles: new MockTiles(baseUrl),
      sms: new MockSms(),
      email: new MockEmail(),
      payments: new MockPayments(baseUrl),
    };
  }
  const production = appEnv === 'production';
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!production && stripeKey?.startsWith('sk_live')) {
    throw new Error('Refusing to use a live Stripe key outside production');
  }
  return {
    mode,
    // Road times when the free OpenRouteService key is set (issue 65); straight-line estimates without it.
    router: env.ORS_API_KEY ? new LiveRouteMatrix(env.ORS_API_KEY) : noRouter(),
    push: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? new LivePush(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT ?? baseUrl) : noPush(),
    weather: new LiveWeather(env.NWS_USER_AGENT ?? '(flake.216labs.dev, sam@216labs.dev)'),
    parcel: new LiveParcels(),
    footprints: new LiveFootprints(env.OVERTURE_EXTRACT_PATH),
    osm: new LiveOsm(env.OVERPASS_URL),
    geocoder: new LiveGeocoder(),
    tiles: new LiveTiles(env.MAPBOX_TOKEN),
    sms: production && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? new LiveSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) : production ? unconfiguredSms() : new MockSms(),
    email: env.RESEND_API_KEY ? new LiveEmail(env.RESEND_API_KEY, env.EMAIL_FROM?.trim() || 'notifications@flake.216labs.dev') : noEmail(),
    payments: stripeKey
      ? new LivePayments(stripeKey, env.STRIPE_PUBLISHABLE_KEY ?? null, [env.STRIPE_WEBHOOK_SECRET ?? '', env.STRIPE_CONNECT_WEBHOOK_SECRET ?? ''], { monthly: env.STRIPE_PRICE_PRO_MONTHLY, yearly: env.STRIPE_PRICE_PRO_YEARLY })
      : production ? unconfiguredPayments() : new MockPayments(baseUrl),
  };
}
