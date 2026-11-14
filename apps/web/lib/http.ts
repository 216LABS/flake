import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { readableIssue } from './issues';
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
