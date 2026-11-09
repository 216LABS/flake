/** Browser fetch helper for the office UI. Throws with the server's message so forms can show it. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // The host's own error pages (a timeout, a deploy in progress) are plain text or HTML, not our JSON.
  }
  if (!res.ok) throw Object.assign(new Error(data?.error ?? (res.status >= 500 ? 'The server did not answer in time. Check your connection and try again.' : `Request failed (${res.status})`)), { status: res.status, code: data?.code });
  return data as T;
}

/** +12165550101 reads as (216) 555-0101. Anything else stays as it is. */
export const phone = (e164: string | null | undefined) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
};

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '-' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const dollarsToCents = (v: string | number) => Math.round(Number(v) * 100);
