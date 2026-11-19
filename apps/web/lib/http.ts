import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { readableIssue } from './issues';
import { serviceDb, sql } from '@flake/db';
import { log } from './log';

export { readableIssue };

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
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

/** This instance's own count: a quick first check that needs no database. */
function localLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size > 10000) buckets.clear();
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) throw new HttpError(429, 'Too many requests');
}

/**
 * A limit every server instance shares (issue 176): on Vercel one address's requests land on many instances, so a count
 * kept in memory never reached the limit. Counts live in Postgres per key and fixed window. The memory count still runs
 * first, so a flood from one instance is refused without a database write. If the database can't be reached the request
 * goes through: a limit is a backstop, not a reason to take the site down.
 */
export async function rateLimit(key: string, max: number, windowMs: number) {
  localLimit(key, max, windowMs);
  // No address to count by (only tests and local tools call without one): everyone would share one bucket.
  if (/:(null|unknown)$/.test(key)) return;
  const start = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  let n: number;
  try {
    const rows = (await serviceDb().execute(sql`
      insert into rate_limit (key, window_start) values (${key.slice(0, 200)}, ${start})
      on conflict (key, window_start) do update set n = rate_limit.n + 1
      returning n`)) as unknown as { n: number }[];
    n = rows[0]?.n ?? 0;
    // Old windows are swept now and then, by whichever request happens to draw it.
    if (Math.random() < 0.01) await serviceDb().execute(sql`delete from rate_limit where window_start < now() - interval '1 day'`);
  } catch (err) {
    log.error('rate limit store failed', err, { key: key.split(':')[0] });
    return;
  }
  if (n > max) throw new HttpError(429, 'Too many requests');
}

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

/**
 * Driver links are limited per link, not per address: phone carriers put thousands of phones behind one
 * address, so on a storm night drivers from many companies would share a single allowance. A much looser
 * per-address cap still slows anyone trying made-up links.
 */
export function driverRateLimit(req: Request, token: string, max = 600, kind = 'd') {
  // Kept in memory on purpose: drivers' phones call these all night, and the links are long random tokens nobody can
  // guess, so a database write on every tap would cost more than it guards (issue 176, D19).
  localLimit(`${kind}:${token.slice(0, 64)}`, max, 60000);
  const ip = clientIp(req);
  if (ip) localLimit(`${kind}ip:${ip}`, max * 20, 60000);
}

export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized');
}
