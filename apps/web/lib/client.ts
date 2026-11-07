/** Browser fetch helper for the office UI. Throws with the server's message so forms can show it. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Request failed (${res.status})`), { status: res.status, code: data?.code });
  return data as T;
}

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '-' : `$${(cents / 100).toFixed(2)}`);
export const dollarsToCents = (v: string | number) => Math.round(Number(v) * 100);
