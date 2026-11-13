import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { log } from './log';

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** What people call a field, where its name in the request isn't it. */
const FIELD_NAMES: Record<string, string> = {
  amount_cents: 'The price', total_cents: 'The season price', rate_cents: 'The hourly rate', trigger_in: 'The trigger depth', up_to_in: 'A tier depth',
  per_sqft_cents_per_push: 'Cents per sq ft', min_push_cents: 'The minimum push', walks_per_lf_cents: 'Cents per foot of walk', salt_bag_cents: 'Salt per bag',
  season_pushes: 'Pushes per season', sqft: 'The area', area_confirmed_sqft: 'The area', area_estimate_sqft: 'The area', walk_lf: 'Walks', walks_lf: 'Walks',
  installments: 'Installments', depth_in: 'The snow depth', phone_e164: 'The phone number',
};

/**
 * Plain sentences instead of the validator's wording (issue 27). "amount_cents: Too small: expected number to be >=0"
 * becomes "The price must be at least $0.00." Messages written for people, like a refine's, pass through as they are.
 */
export function readableIssue(issue: z.core.$ZodIssue) {
  const key = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  const name = (key && FIELD_NAMES[key]) ?? (key ? key.replace(/_e164$/, '').replace(/_|(?=[A-Z])/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'This');
  const money = Boolean(key?.endsWith('_cents')) && !key?.startsWith('per_sqft') && !key?.startsWith('walks_per');
  const show = (n: number | bigint) => (money ? `$${(Number(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(n).toLocaleString('en-US'));
  const i = issue as z.core.$ZodIssue & { origin?: string; minimum?: number | bigint; maximum?: number | bigint; inclusive?: boolean; expected?: string };
  const missing = (i.code === 'too_small' && i.origin === 'string' && Number(i.minimum) === 1) || (i.code === 'invalid_type' && /received undefined/.test(i.message));
  if (missing) return `${name} is required.`;
  if (i.code === 'too_small' && i.origin === 'number') return i.inclusive === false ? `${name} must be more than ${show(i.minimum!)}.` : `${name} must be at least ${show(i.minimum!)}.`;
  if (i.code === 'too_big' && i.origin === 'number') return i.inclusive === false ? `${name} must be less than ${show(i.maximum!)}.` : `${name} must be ${show(i.maximum!)} or less.`;
  if (i.code === 'too_small' && i.origin === 'string') return `${name} must be at least ${i.minimum} characters.`;
  if (i.code === 'too_big' && i.origin === 'string') return `${name} must be ${i.maximum} characters or fewer.`;
  if (i.code === 'too_small' && i.origin === 'array') return `Choose at least ${i.minimum}.`;
  if (i.code === 'too_big' && i.origin === 'array') return `Choose ${i.maximum} or fewer.`;
  if (i.code === 'invalid_type' && i.expected === 'int') return `${name} must be a whole number.`;
  if (i.code === 'invalid_type' && i.expected === 'number') return `${name} must be a number.`;
  if (i.code === 'invalid_format') return `${name} isn't in the right format.`;
  // A message someone wrote for people, from a refine or a regex.
  if (!/expected|invalid input/i.test(i.message)) return /[.!?]$/.test(i.message) ? i.message : `${i.message}.`;
  return `${name} isn't valid.`;
}

export async function parseJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const out = schema.safeParse(body);
  if (!out.success) throw new HttpError(422, [...new Set(out.error.issues.map(readableIssue))].join(' '), 'validation');
  return out.data;
}

export function parseQuery<T extends z.ZodTypeAny>(value: unknown, schema: T): z.infer<T> {
  const out = schema.safeParse(value);
  if (!out.success) throw new HttpError(422, [...new Set(out.error.issues.map(readableIssue))].join(' '), 'validation');
  return out.data;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

/** Wraps a route: JSON responses, typed errors, and no internals leaked to the client. */
export function route<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const out = await handler(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof Error && err.message.endsWith('is not configured')) {
        return NextResponse.json({ error: 'This is not set up yet. Payments and texts turn on once their accounts are connected.', code: 'not_configured' }, { status: 503 });
      }
      const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
      // Postgres permission and RLS refusals: the user's role or tenant doesn't allow this.
      if (code === '42501') return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
      if (code === '22P02') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (code === '23503') return NextResponse.json({ error: 'This is still in use, so it cannot be removed.' }, { status: 409 });
      if (code === '23505') return NextResponse.json({ error: 'That already exists.' }, { status: 409 });
      log.error('route failed', err, { path: new URL(req.url).pathname });
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}

const buckets = new Map<string, { n: number; reset: number }>();

/** Per-instance limiter for token and public routes. A coarse backstop, not a distributed quota. */
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size > 10000) buckets.clear();
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) throw new HttpError(429, 'Too many requests');
}

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

/**
 * Driver links are limited per link, not per address: phone carriers put thousands of phones behind one
 * address, so on a storm night drivers from many companies would share a single allowance. A much looser
 * per-address cap still slows anyone trying made-up links.
 */
export function driverRateLimit(req: Request, token: string, max = 600, kind = 'd') {
  rateLimit(`${kind}:${token.slice(0, 64)}`, max, 60000);
  const ip = clientIp(req);
  if (ip) rateLimit(`${kind}ip:${ip}`, max * 20, 60000);
}

export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized');
}
