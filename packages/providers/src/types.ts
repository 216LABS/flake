import type { MultiPolygon, Polygon } from 'geojson';

export type Geom = Polygon | MultiPolygon;

export interface FetchedDoc {
  notModified: false;
  url: string;
  raw: Uint8Array;
  json: any;
  lastModified: string | null;
  synthetic?: boolean;
}
export type FetchResult = FetchedDoc | { notModified: true; url: string };

export interface GridRef {
  office: string;
  gridX: number;
  gridY: number;
  station: string | null;
}

export interface NohrscResult {
  url: string;
  raw: Uint8Array;
  lastModified: string | null;
  validAt: string;
  /** Snowfall in inches per point id. null when the point has no data. */
  samples: Record<string, number | null>;
  synthetic?: boolean;
}

/** One observation from an airport weather station (ASOS/AWOS). null is "not reported", never zero. */
export interface StationHour { t: string; temp_f: number | null; precip_in: number | null; wx: string | null; snow_depth_in: number | null }

export interface StationHistory {
  url: string;
  raw: Uint8Array;
  /** Who keeps the archive, in words for a proof packet. */
  provider: string;
  rows: StationHour[];
  synthetic?: boolean;
}

export interface WeatherProvider {
  pointToGrid(lat: number, lon: number): Promise<GridRef>;
  fetchGridpoint(office: string, x: number, y: number, ifModifiedSince?: string | null): Promise<FetchResult>;
  fetchAlerts(lat: number, lon: number, at: Date): Promise<FetchedDoc>;
  fetchObservation(station: string, at: Date): Promise<FetchedDoc>;
  fetchNohrsc(hours: 6 | 24, at: Date, points: { id: string; lat: number; lon: number }[]): Promise<NohrscResult | null>;
  /** Observed weather at a station for any past window, not only the last few days the NWS keeps (issue 163). */
  fetchStationHistory(station: string, from: Date, to: Date): Promise<StationHistory | null>;
}

export interface Parcel {
  id: string;
  county: string;
  geometry: Geom;
  attribution: string;
}
export interface ParcelProvider {
  lookup(lat: number, lon: number): Promise<Parcel | null>;
}
export interface FootprintProvider {
  within(lat: number, lon: number, radiusM: number): Promise<Geom[]>;
}
export interface OsmProvider {
  parkingNear(lat: number, lon: number, radiusM: number): Promise<Geom[]>;
}
export interface GeocodeHit {
  label: string;
  lat: number;
  lon: number;
}
export interface SuggestOptions {
  /** Keep results near here: the company's yard or its first site (issue 87). */
  near?: { lat: number; lon: number } | null;
  /** After a save found no exact match: also try the house numbers next door, and the street itself. */
  expand?: boolean;
}
export interface Geocoder {
  search(q: string): Promise<GeocodeHit[]>;
  /** Type-ahead. Best effort: an empty list just means the person keeps typing and uses Find. */
  suggest(q: string, opts?: SuggestOptions): Promise<GeocodeHit[]>;
}
export interface TileLayer {
  tiles: string[];
  attribution: string;
  maxzoom?: number;
}
export interface TileProvider {
  layers(): { streets: TileLayer; satellite: TileLayer };
}

export interface SmsSend {
  from: string;
  to: string;
  body: string;
  subaccountSid: string | null;
  statusCallback?: string;
}
export interface TollFreePayload {
  legal_name: string;
  ein: string;
  address: { line1: string; city: string; state: string; zip: string };
  website: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  use_case: string;
  expected_monthly_volume: number;
  opt_in_description: string;
  opt_in_screenshot_url: string;
  sample_messages: string[];
}
export interface SmsProvider {
  /** Set when the platform has no Twilio keys: every call refuses (issues 173, 175). */
  unconfigured?: boolean;
  send(msg: SmsSend): Promise<{ id: string; status: string }>;
  provisionTenant(friendlyName: string, webhookBase: string): Promise<{ subaccountSid: string; sender: string }>;
  submitTollFreeVerification(subaccountSid: string, sender: string, payload: TollFreePayload, webhookBase: string): Promise<{ id: string; status: 'pending' | 'approved' | 'rejected' }>;
  /** Validates X-Twilio-Signature against the full URL and form params. */
  verifyWebhook(url: string, params: Record<string, string>, signature: string | null): boolean | Promise<boolean>;
  /** Where a toll-free verification stands now, or null when this provider can't say. */
  tollFreeStatus?(verificationId: string): Promise<{ status: 'pending' | 'approved' | 'rejected'; reason: string | null } | null>;
}

export interface EmailSend {
  fromName: string;
  replyTo?: string | null;
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  attachments?: { filename: string; content: Uint8Array }[];
}
export interface EmailProvider {
  send(msg: EmailSend): Promise<{ id: string; status: string }>;
}

export interface StripeEventLike {
  id: string;
  type: string;
  account?: string;
  data: { object: any };
}

export interface ChargeResult {
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  paymentIntentId: string | null;
  failure?: string;
  events: StripeEventLike[];
}

export interface PaymentsProvider {
  /** Set when the platform has no Stripe keys: every call refuses (issue 175). */
  unconfigured?: boolean;
  createConnectedAccount(input: { email: string | null; businessName: string; tenantId: string }): Promise<{ accountId: string }>;
  createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }>;
  /** Whether a connected account can take charges yet, straight from Stripe. Optional: the mock learns it by event. */
  chargesEnabled?(accountId: string): Promise<boolean>;
  ensureCustomer(accountId: string, input: { existingId?: string | null; email?: string | null; name: string; tenantId: string; customerId: string }): Promise<{ customerId: string }>;
  createSetupIntent(accountId: string, customerId: string, metadata: Record<string, string>): Promise<{ id: string; clientSecret: string; publishableKey: string | null; mock: boolean }>;
  chargeOffSession(accountId: string, input: { customerId: string; paymentMethodId: string; amountCents: number; feeCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<ChargeResult>;
  createPayLink(accountId: string, input: { amountCents: number; feeCents: number; description: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; url: string }>;
  createInvoice(accountId: string, input: { customerId: string; lines: { description: string; amountCents: number }[]; feeCents: number; daysUntilDue: number; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<{ invoiceId: string; hostedUrl: string | null; events: StripeEventLike[] }>;
  createProCheckout(input: { tenantId: string; customerId?: string | null; email?: string | null; interval: 'monthly' | 'yearly'; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  verifyWebhook(rawBody: string, signature: string | null): StripeEventLike;
  isMock: boolean;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
}
export interface PushProvider {
  /** Handed to the browser to subscribe. null means push is off on this deployment. */
  publicKey: string | null;
  send(target: PushTarget, message: PushMessage): Promise<{ status: 'sent' | 'gone' }>;
}

/**
 * Driving minutes between every pair of points, from a road router (issue 65). Null means "no road times": the caller
 * plans with straight-line estimates. A failure throws, and the caller falls back the same way.
 */
export interface RouteMatrix {
  /** What the minutes came from, for the "Drive times are ..." line. */
  readonly source: string;
  /** The most points one call takes. Bigger routes use estimates. */
  readonly maxPoints: number;
  minutes(points: { lat: number; lon: number }[]): Promise<(number | null)[][] | null>;
  /** One block of a bigger matrix: minutes from each of `from` to each of `to` (issue 194), up to maxPoints each. */
  block?(from: { lat: number; lon: number }[], to: { lat: number; lon: number }[]): Promise<(number | null)[][] | null>;
}

export interface Providers {
  router: RouteMatrix;
  push: PushProvider;
  mode: 'mock' | 'live';
  weather: WeatherProvider;
  parcel: ParcelProvider;
  footprints: FootprintProvider;
  osm: OsmProvider;
  geocoder: Geocoder;
  tiles: TileProvider;
  sms: SmsProvider;
  email: EmailProvider;
  payments: PaymentsProvider;
  accounting: AccountingProvider;
}

/** QuickBooks Online (issue 162). Access tokens last an hour; the app refreshes them and keeps them encrypted. */
export interface QboTokens { access: string; refresh: string; expiresAt: string; realmId: string }
export interface QboAuth { access: string; realmId: string }
export interface QboCustomer { id: string; name: string; email: string | null }
export interface QboItem { id: string; name: string }
export interface QboInvoiceInput {
  customerId: string;
  docNumber: string;
  txnDate: string;
  dueDate: string;
  memo: string;
  lines: { itemId: string; description: string; qty: number; rateCents: number; amountCents: number }[];
}
export interface QboInvoiceRef { id: string; syncToken: string; totalCents: number; balanceCents: number }
export interface AccountingProvider {
  /** False when this server has no Intuit app keys: Settings says so instead of offering Connect. */
  configured: boolean;
  isMock: boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, realmId: string, redirectUri: string): Promise<QboTokens>;
  refresh(refreshToken: string, realmId: string): Promise<QboTokens>;
  revoke(refreshToken: string): Promise<void>;
  listCustomers(auth: QboAuth): Promise<QboCustomer[]>;
  createCustomer(auth: QboAuth, c: { name: string; email: string | null }): Promise<QboCustomer>;
  listItems(auth: QboAuth): Promise<QboItem[]>;
  /** requestId makes a retry return the same invoice instead of a second one. */
  createInvoice(auth: QboAuth, inv: QboInvoiceInput, requestId: string): Promise<QboInvoiceRef>;
  /** Null when it was deleted in QuickBooks. */
  getInvoice(auth: QboAuth, id: string): Promise<QboInvoiceRef | null>;
  createPayment(auth: QboAuth, p: { customerId: string; invoiceId: string; amountCents: number; txnDate: string; ref: string }, requestId: string): Promise<{ id: string }>;
  /** Intuit's webhook signature: base64 HMAC-SHA256 of the body with the app's verifier token. */
  verifyWebhook(body: string, signature: string | null): boolean;
}
