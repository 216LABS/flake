import crypto from 'node:crypto';
import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import { expandSeries, sumRange, toInches } from '@flake/core/trigger';
import { buildManifest } from '@flake/core/proof';
import { LiveEmail, LiveGeocoder, LivePush, LiveSms, LiveWeather, MockEmail, MockFootprints, MockGeocoder, MockOsm, MockParcels, MockPayments, MockSms, MockTiles, MockWeather, countyParcels, createProviders, nearestValidCell, nohrscCellToInches, nohrscUrl, signMockWebhook, signTwilio, MOCK_TWILIO_TOKEN, type EmailProvider, type Geocoder, type PaymentsProvider, type SmsProvider, type WeatherProvider } from '../src/index';
import { renderContractPdf, renderProofPdf } from '../src/pdf';

const live = process.env.LIVE_PROVIDER_TESTS === '1';
const POINT = { lat: 41.4819, lon: -81.7982 };

/** The same contract runs against the mock always and the real provider only with LIVE_PROVIDER_TESTS=1. */
function weatherContract(name: string, make: () => WeatherProvider, enabled = true) {
  describe.runIf(enabled)(`WeatherProvider contract: ${name}`, () => {
    it('maps a point to a grid cell', async () => {
      const g = await make().pointToGrid(POINT.lat, POINT.lon);
      expect(g.office).toMatch(/^[A-Z]{3}$/);
      expect(Number.isInteger(g.gridX)).toBe(true);
    });
    it('returns a gridpoint document with raw bytes and a snowfall layer', async () => {
      const w = make();
      const g = await w.pointToGrid(POINT.lat, POINT.lon);
      const doc = await w.fetchGridpoint(g.office, g.gridX, g.gridY);
      expect(doc.notModified).toBe(false);
      if (doc.notModified) return;
      expect(doc.raw.length).toBeGreaterThan(0);
      expect(doc.json.properties.snowfallAmount.values).toBeInstanceOf(Array);
    });
    it('returns alerts as features', async () => {
      const doc = await make().fetchAlerts(POINT.lat, POINT.lon, new Date('2025-12-12T20:00:00Z'));
      expect(doc.json.features).toBeInstanceOf(Array);
    });
  });
}
weatherContract('mock', () => new MockWeather('lakewood-lake-effect-2025-12'));
weatherContract('nws', () => new LiveWeather('(flake.216labs.dev, sam@216labs.dev)'), live);

function geocoderContract(name: string, make: () => Geocoder, enabled = true) {
  describe.runIf(enabled)(`Geocoder contract: ${name}`, () => {
    it('finds an address', async () => {
      const hits = await make().search('14701 Detroit Ave, Lakewood, OH');
      expect(hits[0]!.lat).toBeCloseTo(41.48, 0);
    });
  });
}
geocoderContract('mock', () => new MockGeocoder());
geocoderContract('census', () => new LiveGeocoder(), live);

function smsContract(name: string, make: () => SmsProvider) {
  describe(`SmsProvider contract: ${name}`, () => {
    it('sends and returns an id', async () => {
      const r = await make().send({ from: '+18335550100', to: '+12165550101', body: 'x', subaccountSid: 'AC1' });
      expect(r.id).toBeTruthy();
    });
  });
}
smsContract('mock', () => new MockSms());

function emailContract(name: string, make: () => EmailProvider) {
  describe(`EmailProvider contract: ${name}`, () => {
    it('sends and returns an id', async () => {
      expect((await make().send({ fromName: 'A', to: 'a@flake.test', subject: 's', text: 't', idempotencyKey: 'k' })).id).toBeTruthy();
    });
  });
}
emailContract('mock', () => new MockEmail());

function paymentsContract(name: string, make: () => PaymentsProvider) {
  describe(`PaymentsProvider contract: ${name}`, () => {
    it('creates an account and a customer', async () => {
      const p = make();
      const { accountId } = await p.createConnectedAccount({ email: null, businessName: 'A', tenantId: 't1' });
      expect(accountId).toMatch(/^acct_/);
      expect((await p.ensureCustomer(accountId, { name: 'n', tenantId: 't1', customerId: 'c1' })).customerId).toMatch(/^cus_/);
    });
  });
}
paymentsContract('mock', () => new MockPayments('http://x'));

describe('MockWeather', () => {
  it('reproduces the 0.5, 3.2, 1.1 inch fixture exactly', async () => {
    const doc = await new MockWeather('lakewood-lake-effect-2025-12').fetchGridpoint('CLE', 1, 1);
    if (doc.notModified) throw new Error('unexpected');
    const layer = doc.json.properties.snowfallAmount;
    const b = expandSeries(layer.values, (v) => toInches(v, layer.uom));
    const day = (d: string, h = 24) => sumRange(b, Date.parse(d), Date.parse(d) + h * 3600000);
    expect(day('2025-12-12T18:00:00Z', 6)).toBe(0.5);
    expect(day('2025-12-13T00:00:00Z')).toBe(3.2);
    expect(day('2025-12-14T00:00:00Z')).toBe(1.1);
  });
  it('labels every response as synthetic', async () => {
    const w = new MockWeather('quiet');
    const a = await w.fetchAlerts(1, 2, new Date());
    expect(a.synthetic).toBe(true);
    expect(a.url.startsWith('mock://')).toBe(true);
    expect(a.json._synthetic).toBe(true);
  });
  it('honors If-Modified-Since', async () => {
    const r = await new MockWeather('quiet').fetchGridpoint('CLE', 1, 1, '2030-01-01T00:00:00Z');
    expect(r.notModified).toBe(true);
  });
  it('only reports alerts active at the given time', async () => {
    const w = new MockWeather('lakewood-lake-effect-2025-12');
    expect((await w.fetchAlerts(1, 2, new Date('2025-12-12T10:00:00Z'))).json.features).toHaveLength(0);
    expect((await w.fetchAlerts(1, 2, new Date('2025-12-12T20:00:00Z'))).json.features).toHaveLength(1);
  });
  it('samples NOHRSC at points, and returns null before any analysis exists', async () => {
    const w = new MockWeather('lakewood-lake-effect-2025-12');
    const r = await w.fetchNohrsc(24, new Date('2025-12-13T13:00:00Z'), [{ id: 'a', lat: 1, lon: 2 }]);
    expect(r!.samples.a).toBe(3.2);
    expect(await w.fetchNohrsc(24, new Date('2020-01-01T00:00:00Z'), [])).toBeNull();
  });
});

describe('LiveWeather', () => {
  const stub = (status: number, body: unknown, headers: Record<string, string> = {}) => (async () => new Response(status === 304 ? null : JSON.stringify(body), { status, headers })) as typeof fetch;
  it('sends the required User-Agent and If-Modified-Since, and handles 304', async () => {
    let seen: Headers | undefined;
    const w = new LiveWeather('(flake.216labs.dev, sam@216labs.dev)', (async (_u: any, init: any) => {
      seen = new Headers(init.headers);
      return new Response(null, { status: 304 });
    }) as typeof fetch);
    const r = await w.fetchGridpoint('CLE', 1, 2, '2025-12-12T06:00:00Z');
    expect(r.notModified).toBe(true);
    expect(seen!.get('user-agent')).toContain('flake.216labs.dev');
    expect(seen!.get('if-modified-since')).toBe('Fri, 12 Dec 2025 06:00:00 GMT');
  });
  it('keeps raw bytes and Last-Modified', async () => {
    const r = await new LiveWeather('ua', stub(200, { properties: {} }, { 'last-modified': 'Fri, 12 Dec 2025 06:00:00 GMT' })).fetchGridpoint('CLE', 1, 2);
    if (r.notModified) throw new Error('unexpected');
    expect(r.lastModified).toContain('2025');
    expect(new TextDecoder().decode(r.raw)).toContain('properties');
  });
  it('throws on server errors so the breaker can count them', async () => {
    await expect(new LiveWeather('ua', stub(500, {})).fetchGridpoint('CLE', 1, 2)).rejects.toThrow('NWS 500');
  });
  it('builds the checked NOHRSC URL', () => {
    expect(nohrscUrl(24, new Date('2026-02-01T12:00:00Z'))).toBe('https://www.nohrsc.noaa.gov/snowfall_v2/data/202602/sfav2_CONUS_24h_2026020112.tif');
  });
  it('walks back to an older NOHRSC file and returns null when none exist', async () => {
    expect(await new LiveWeather('ua', stub(404, {})).fetchNohrsc(24, new Date('2026-02-01T13:00:00Z'), [])).toBeNull();
  });
});

describe('web push', () => {
  const { createECDH, randomBytes } = crypto;
  const target = (endpoint: string) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  };
  const keys = webpush.generateVAPIDKeys();
  const live = new LivePush(keys.publicKey, keys.privateKey, 'mailto:test@flake.test');
  const msg = { title: 't', body: 'secret body', url: '/x' };
  const failing = (statusCode: number) => vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(Object.assign(new Error('push'), { statusCode }));

  it('produces an encrypted, VAPID-signed request with the body not in the clear', () => {
    const t = target('https://fcm.googleapis.com/fcm/send/x');
    const details = webpush.generateRequestDetails({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(msg), { vapidDetails: { subject: 'mailto:test@flake.test', publicKey: keys.publicKey, privateKey: keys.privateKey } });
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(details.headers.Authorization)).toContain(keys.publicKey);
    expect(Buffer.from(details.body as Buffer).toString('latin1')).not.toContain('secret body');
  });
  it('sends through the library with our keys', async () => {
    const spy = vi.spyOn(webpush, 'sendNotification').mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });
    const t = target('https://fcm.googleapis.com/fcm/send/x');
    expect((await live.send(t, msg)).status).toBe('sent');
    expect(spy.mock.calls[0]![0]).toEqual({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } });
    expect(spy.mock.calls[0]![2]!.vapidDetails!.publicKey).toBe(keys.publicKey);
  });
  it('reports a dead subscription as gone, and a server error as a failure to retry', async () => {
    failing(410);
    expect((await live.send(target('https://x/1'), msg)).status).toBe('gone');
    failing(404);
    expect((await live.send(target('https://x/2'), msg)).status).toBe('gone');
    failing(500);
    await expect(live.send(target('https://x/3'), msg)).rejects.toThrow('status 500');
  });
  it('is off with no keys and on with both, in every environment', () => {
    const base = { mode: 'live' as const, baseUrl: 'http://x' };
    expect(createProviders({ ...base, appEnv: 'production', env: {} }).push.publicKey).toBeNull();
    expect(createProviders({ ...base, appEnv: 'staging', env: { VAPID_PUBLIC_KEY: 'p' } }).push.publicKey).toBeNull();
    expect(createProviders({ ...base, appEnv: 'staging', env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey } }).push).toBeInstanceOf(LivePush);
  });
});

describe('address suggestions', () => {
  const photon = (features: unknown[]) => new LiveGeocoder((async () => new Response(JSON.stringify({ features }))) as typeof fetch);
  const place = (p: Record<string, string>, c = [-81.8, 41.48]) => ({ geometry: { coordinates: c }, properties: { countrycode: 'US', ...p } });
  it('writes a usable address, drops other countries and duplicates, and reads coordinates the right way round', async () => {
    const hits = await photon([
      place({ housenumber: '14701', street: 'Detroit Avenue', city: 'Lakewood', state: 'Ohio', postcode: '44107' }),
      place({ housenumber: '14701', street: 'Detroit Avenue', city: 'Lakewood', state: 'Ohio', postcode: '44107' }),
      { geometry: { coordinates: [1, 2] }, properties: { countrycode: 'CA', street: 'Detroit St', city: 'Windsor' } },
      place({ city: 'Lakewood', state: 'Ohio' }),
    ]).suggest('14701 Detroit');
    expect(hits).toEqual([{ label: '14701 Detroit Avenue, Lakewood, OH 44107', lat: 41.48, lon: -81.8 }]);
  });
  it('never offers a different address from the house number typed', async () => {
    const hits = await photon([
      place({ name: 'Madison Ave Car Wash', street: 'Newman Avenue', city: 'Lakewood', state: 'Ohio' }),
      place({ housenumber: '13100', street: 'Madison Avenue', city: 'Lakewood', state: 'Ohio' }),
      place({ housenumber: '13400', street: 'Madison Avenue', city: 'Lakewood', state: 'Ohio' }),
    ]).suggest('13400 Madison Ave Lakewood');
    expect(hits.map((h) => h.label)).toEqual(['13400 Madison Avenue, Lakewood, OH']);
  });
  it('leaves out businesses that have no house number', async () => {
    const hits = await photon([
      place({ name: 'Madison Ave Car Wash', street: 'Newman Avenue', city: 'Lakewood', state: 'Ohio' }),
      place({ name: 'Madison Avenue', street: 'Madison Avenue', city: 'Lakewood', state: 'Ohio' }),
    ]).suggest('Madison Ave Lakewood');
    expect(hits.map((h) => h.label)).toEqual(['Madison Avenue, Lakewood, OH']);
  });
  it('treats a slow or failing service as no suggestions, never an error', async () => {
    expect(await new LiveGeocoder((async () => { throw new Error('down'); }) as typeof fetch).suggest('x y z')).toEqual([]);
    expect(await new LiveGeocoder((async () => new Response('nope', { status: 500 })) as typeof fetch).suggest('x y z')).toEqual([]);
  });
  it('the mock is deterministic', async () => {
    expect(await new MockGeocoder().suggest('12 Main')).toEqual(await new MockGeocoder().suggest('12 Main'));
  });
});

describe('checked against live data', () => {
  it('reads NOHRSC cells as inches and nodata as unavailable', () => {
    expect(nohrscCellToInches(17.3025, -99999)).toBe(17.3);
    expect(nohrscCellToInches(0, -99999)).toBe(0);
    expect(nohrscCellToInches(-99999, -99999)).toBeNull();
    expect(nohrscCellToInches(-1, null)).toBeNull();
  });
  it('falls back to the nearest valid cell when the point is in masked water', () => {
    const N = -99999;
    expect(nearestValidCell([1, 1, 1, 1, 5, 1, 1, 1, 1], 0.5, 0.5, N)).toBe(5);
    // Lakewood: its own cell and everything north is lake. The closest land is straight south.
    expect(nearestValidCell([N, N, N, N, N, N, 0.2, 0.4, 0.3], 0.5, 0.95, N)).toBe(0.4);
    expect(nearestValidCell([N, N, N, N, N, N, N, N, N], 0.5, 0.5, N)).toBeNull();
  });
  it('only queries counties with a verified or configured endpoint', () => {
    expect(countyParcels({}).map((c) => c.county)).toEqual(['cuyahoga']);
    expect(countyParcels({ PARCEL_URL_LAKE: 'https://x/query' }).map((c) => c.county)).toEqual(['cuyahoga', 'lake']);
  });
});

describe('factory safety', () => {
  const base = { mode: 'live' as const, baseUrl: 'http://x' };
  it('refuses a live Stripe key outside production', () => {
    expect(() => createProviders({ ...base, appEnv: 'staging', env: { STRIPE_SECRET_KEY: 'sk_live_x' } })).toThrow(/Refusing/);
  });
  it('blocks real SMS outside production even with keys present', () => {
    const p = createProviders({ ...base, appEnv: 'staging', env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't' } });
    expect(p.sms).toBeInstanceOf(MockSms);
    expect(createProviders({ ...base, appEnv: 'production', env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't' } }).sms).toBeInstanceOf(LiveSms);
  });
  it('production refuses mock mode, and a missing key fails closed instead of falling back to a mock', async () => {
    expect(() => createProviders({ mode: 'mock', appEnv: 'production', baseUrl: 'http://x', env: {} })).toThrow(/not allowed in production/);
    const p = createProviders({ ...base, appEnv: 'production', env: {} });
    expect(p.payments.isMock).toBe(false);
    await expect(p.payments.chargeOffSession('a', {} as never)).rejects.toThrow(/not configured/);
    expect(() => p.payments.verifyWebhook('{}', signMockWebhook('{}'))).toThrow();
    expect(p.sms.verifyWebhook('http://x', {}, signTwilio(MOCK_TWILIO_TOKEN, 'http://x', {}))).toBe(false);
    expect((await p.email.send({} as never)).status).toBe('not_sent');
  });
  it('the free test setup: real weather, mock money and texts, and honest about email', async () => {
    const p = createProviders({ ...base, appEnv: 'staging', env: {} });
    expect(p.weather).toBeInstanceOf(LiveWeather);
    expect(p.payments).toBeInstanceOf(MockPayments);
    expect(p.sms).toBeInstanceOf(MockSms);
    expect((await p.email.send({} as never)).status).toBe('not_sent');
  });
  it('mock mode never touches a real provider', () => {
    const p = createProviders({ mode: 'mock', appEnv: 'staging', baseUrl: 'http://x', env: { STRIPE_SECRET_KEY: 'sk_live_x', RESEND_API_KEY: 'x' } });
    expect(p.email).toBeInstanceOf(MockEmail);
    expect(p.payments).toBeInstanceOf(MockPayments);
  });
});

describe('mock payments', () => {
  const p = new MockPayments('http://x');
  const charge = (pm: string, key = 'draft-1') => p.chargeOffSession('acct', { customerId: 'c', paymentMethodId: pm, amountCents: 1000, feeCents: 50, idempotencyKey: key, description: 'd', metadata: {} } as never);
  it('succeeds for 4242 and declines for 0002', async () => {
    expect((await charge('pm_mock_4242')).status).toBe('succeeded');
    const failed = await charge('pm_mock_0002');
    expect(failed.status).toBe('failed');
    expect(failed.events[0]!.type).toBe('payment_intent.payment_failed');
  });
  it('is deterministic per idempotency key', async () => {
    expect((await charge('pm_mock_4242')).paymentIntentId).toBe((await charge('pm_mock_4242')).paymentIntentId);
    expect((await charge('pm_mock_4242')).events[0]!.id).toBe((await charge('pm_mock_4242')).events[0]!.id);
  });
  it('builds a net-30 invoice shape with the fee', async () => {
    const inv = await p.createInvoice('acct', { customerId: 'c', lines: [{ description: 'd', amountCents: 500 }], feeCents: 50, daysUntilDue: 30, idempotencyKey: 'k', description: 'd', metadata: {} } as never);
    expect(inv.events[0]!.data.object).toMatchObject({ collection_method: 'send_invoice', days_until_due: 30, application_fee_amount: 50, amount_due: 500 });
  });
  it('verifies webhook signatures and rejects bad ones', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'x', data: { object: {} } });
    expect(p.verifyWebhook(body, signMockWebhook(body)).id).toBe('evt_1');
    expect(() => p.verifyWebhook(body, signMockWebhook(body, 'wrong'))).toThrow();
    expect(() => p.verifyWebhook(body, null)).toThrow();
    expect(() => p.verifyWebhook(`${body} `, signMockWebhook(body))).toThrow();
  });
});

describe('twilio signature', () => {
  it('matches Twilio documented example and rejects tampering', () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    expect(signTwilio('12345', url, params)).toBe('GvWf1cFY/Q7PnoempGyD5oXAezc=');
    const sms = new MockSms();
    const sig = signTwilio(MOCK_TWILIO_TOKEN, 'http://x/a', { Body: 'STOP' });
    expect(sms.verifyWebhook('http://x/a', { Body: 'STOP' }, sig)).toBe(true);
    expect(sms.verifyWebhook('http://x/a', { Body: 'START' }, sig)).toBe(false);
    expect(sms.verifyWebhook('http://x/a', { Body: 'STOP' }, null)).toBe(false);
  });
});

describe('live clients', () => {
  it('resend sends an idempotency key and surfaces errors', async () => {
    let key: string | null = null;
    const ok = new LiveEmail('k', 'n@flake.test', (async (_u: any, init: any) => {
      key = new Headers(init.headers).get('idempotency-key');
      return new Response(JSON.stringify({ id: 'e1' }));
    }) as typeof fetch);
    expect((await ok.send({ fromName: 'A', to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'abc' })).id).toBe('e1');
    expect(key).toBe('abc');
    const bad = new LiveEmail('k', 'n@flake.test', (async () => new Response(JSON.stringify({ message: 'no' }), { status: 422 })) as typeof fetch);
    await expect(bad.send({ fromName: 'A', to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'abc' })).rejects.toThrow('Resend 422');
  });
  it('keeps the From header valid whatever the company is called', async () => {
    const from = async (fromName: string) => {
      let sent = '';
      const email = new LiveEmail('k', 'n@flake.test', (async (_u: any, init: any) => {
        sent = JSON.parse(init.body).from;
        return new Response(JSON.stringify({ id: 'e1' }));
      }) as typeof fetch);
      await email.send({ fromName, to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'abc' });
      return sent;
    };
    expect(await from('Smith & Sons, LLC')).toBe('Smith & Sons LLC <n@flake.test>');
    expect(await from('Test Co (delete me)')).toBe('Test Co delete me <n@flake.test>');
    expect(await from("Peña's <Plowing>")).toBe("Peña's Plowing <n@flake.test>");
    expect(await from('()')).toBe('n@flake.test');
  });
  it('reports a rate limit as wait and retry, and a daily quota as a longer wait', async () => {
    const limited = (status: number, body: object, headers = {}) => new LiveEmail('k', 'n@flake.test', (async () => new Response(JSON.stringify(body), { status, headers })) as typeof fetch);
    const send = { fromName: 'A', to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'abc' };
    await expect(limited(429, { message: 'Too many requests' }).send(send)).rejects.toMatchObject({ retryAfterSeconds: 5 });
    await expect(limited(429, { message: 'Too many requests' }, { 'retry-after': '30' }).send(send)).rejects.toMatchObject({ retryAfterSeconds: 30 });
    await expect(limited(429, { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota' }).send(send)).rejects.toMatchObject({ retryAfterSeconds: 3600 });
  });
  it('takes the sender address however EMAIL_FROM was written', async () => {
    for (const written of ['n@flake.test', ' n@flake.test\n', '"n@flake.test"', 'Flake <n@flake.test>', '"Flake" <n@flake.test> ']) {
      let sent = '';
      const email = new LiveEmail('k', written, (async (_u: any, init: any) => {
        sent = JSON.parse(init.body).from;
        return new Response(JSON.stringify({ id: 'e1' }));
      }) as typeof fetch);
      await email.send({ fromName: 'Acme', to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'abc' });
      expect(sent).toBe('Acme <n@flake.test>');
    }
  });
  it('twilio sends through the tenant subaccount and refuses without one', async () => {
    let url = '';
    const sms = new LiveSms('AC', 't', (async (u: any) => {
      url = String(u);
      return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }));
    }) as typeof fetch);
    expect((await sms.send({ from: '+1', to: '+2', body: 'x', subaccountSid: 'ACsub' })).id).toBe('SM1');
    expect(url).toContain('/Accounts/ACsub/Messages.json');
    await expect(sms.send({ from: '+1', to: '+2', body: 'x', subaccountSid: null })).rejects.toThrow('no Twilio subaccount');
  });
});

describe('mock geo', () => {
  it('is deterministic', async () => {
    expect((await new MockGeocoder().search('1 Main'))[0]!.lat).toBe((await new MockGeocoder().search('1 main '))[0]!.lat);
    expect(await new MockParcels().lookup(41.48, -81.8)).toEqual(await new MockParcels().lookup(41.48, -81.8));
    expect(await new MockFootprints().within(41.48, -81.8)).toHaveLength(1);
    expect((await new MockOsm().parkingNear(41.48, -81.8)).length).toBeLessThanOrEqual(1);
    expect(new MockTiles('http://x').layers().streets.tiles[0]).toContain('/api/tiles/mock/');
  });
});

describe('pdf', () => {
  const { manifest, hash } = buildManifest({
    contractor: { name: 'Demo', timezone: 'America/New_York' }, customer: { name: 'C' }, site: { id: 's', label: 'L', address: 'A', lat: 1, lon: 2 },
    period: { from: '2025-12-01T00:00:00Z', to: '2025-12-31T00:00:00Z' }, contract: null,
    storms: [{ id: 'st', name: 'Storm', started_at: '2025-12-12T00:00:00Z', closed_at: null, snapshots: [{ id: 'sn', source: 'nws_grid', request_url: 'mock://x', fetched_at: '2025-12-12T00:00:00Z', last_modified: null, sha256: 'a'.repeat(64), summary: { snow_next12h_in: null, synthetic: true } }] }],
    visits: [], messages: [], corrections: [],
  });
  it('renders a proof packet', async () => {
    const pdf = await renderProofPdf({ manifest, manifestSha256: hash, generatedAt: '2026-01-01T00:00:00Z', images: {} });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }, 30000);
  it('renders a contract', async () => {
    const pdf = await renderContractPdf({ company: 'A', customer: 'B', site: 'C', season: '2026-27', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 100 } }], terms: 'T', disclaimer: 'Not legal advice.' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }, 30000);
});
