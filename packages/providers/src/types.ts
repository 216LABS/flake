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

export interface WeatherProvider {
  pointToGrid(lat: number, lon: number): Promise<GridRef>;
  fetchGridpoint(office: string, x: number, y: number, ifModifiedSince?: string | null): Promise<FetchResult>;
  fetchAlerts(lat: number, lon: number, at: Date): Promise<FetchedDoc>;
  fetchObservation(station: string, at: Date): Promise<FetchedDoc>;
  fetchNohrsc(hours: 6 | 24, at: Date, points: { id: string; lat: number; lon: number }[]): Promise<NohrscResult | null>;
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
export interface Geocoder {
  search(q: string): Promise<GeocodeHit[]>;
  /** Type-ahead. Best effort: an empty list just means the person keeps typing and uses Find. */
  suggest(q: string): Promise<GeocodeHit[]>;
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

export interface Providers {
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
}
