import { openDB, type IDBPDatabase } from 'idb';

/**
 * The offline outbox. Everything is written here first, then flushed on online, on visibility, on open, and
 * every 15 s. The server is idempotent on client_uuid, so a flush can repeat safely.
 */
interface StoredAction { seq?: number; token: string; run_stop_id?: string; action: Record<string, unknown> }
/** Plain bytes, because some browsers refuse to store a File or Blob. Rows saved by older versions still hold a blob. */
interface StoredPhoto { client_uuid: string; token: string; bytes?: ArrayBuffer; type?: string; blob?: Blob; meta: Record<string, string> }

const photoBlob = (p: StoredPhoto) => p.blob ?? new Blob([p.bytes!], { type: p.type ?? '' });

/** A write's failure also rejects tx.done, which is what the caller handles. */
const quietly = (write: Promise<unknown>) => void write.catch(() => {});

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB('flake-driver', 1, {
    upgrade(d) {
      d.createObjectStore('actions', { keyPath: 'seq', autoIncrement: true });
      d.createObjectStore('photos', { keyPath: 'client_uuid' });
      d.createObjectStore('kv');
      d.createObjectStore('rejected', { keyPath: 'client_uuid' });
    },
  });
  return dbp;
}

export const kvGet = async <T,>(key: string) => (await (await db()).get('kv', key)) as T | undefined;
export const kvSet = async (key: string, value: unknown) => void (await (await db()).put('kv', value, key));

/**
 * One atomic write: the queued actions, any photo, and the phone's view of the route commit together or not at
 * all. The screen only moves on after this resolves, so a crash or reload can't split a tap in two.
 */
export async function commit(opts: { token: string; localKey: string; local: unknown; actions?: Record<string, unknown>[]; photo?: { blob: Blob; meta: Record<string, string> } }) {
  // Read before the transaction opens: it would close itself while waiting on anything else.
  const bytes = opts.photo ? await opts.photo.blob.arrayBuffer() : null;
  const tx = (await db()).transaction(['actions', 'photos', 'kv'], 'readwrite');
  for (const action of opts.actions ?? []) quietly(tx.objectStore('actions').add({ token: opts.token, run_stop_id: action.run_stop_id as string | undefined, action } satisfies StoredAction));
  if (opts.photo) quietly(tx.objectStore('photos').put({ client_uuid: opts.photo.meta.client_uuid!, token: opts.token, bytes: bytes!, type: opts.photo.blob.type, meta: opts.photo.meta } satisfies StoredPhoto));
  quietly(tx.objectStore('kv').put(opts.local, opts.localKey));
  await tx.done;
}

export async function addAction(token: string, action: Record<string, unknown>) {
  await (await db()).add('actions', { token, run_stop_id: action.run_stop_id as string | undefined, action } satisfies StoredAction);
}

export async function pending(token: string) {
  const d = await db();
  const actions = ((await d.getAll('actions')) as StoredAction[]).filter((a) => a.token === token);
  const photos = ((await d.getAll('photos')) as StoredPhoto[]).filter((p) => p.token === token);
  return { actions: actions.length, photos: photos.length, stopIds: new Set(actions.map((a) => a.run_stop_id).filter(Boolean) as string[]) };
}

let flushing = false;

// Weak storm-night signal can leave a request hanging for minutes. Give up and retry, or the outbox stalls behind it.
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 180_000;

/** The host caps request bodies around 4.5 MB, and full-size photos are often bigger. */
const DIRECT_UPLOAD_OVER_BYTES = 3.5 * 1024 * 1024;

async function sendPhoto(token: string, p: StoredPhoto): Promise<Response> {
  const blob = photoBlob(p);
  if (blob.size <= DIRECT_UPLOAD_OVER_BYTES || p.meta.phase === 'voice') {
    const form = new FormData();
    for (const [k, v] of Object.entries(p.meta)) form.set(k, v);
    form.set('file', blob, `${p.client_uuid}.jpg`);
    return fetch(`/api/d/${token}/photos`, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  }
  const json = { 'Content-Type': 'application/json' };
  const body = JSON.stringify({ ...p.meta, content_type: blob.type || 'image/jpeg' });
  const signed = await fetch(`/api/d/${token}/photos/sign`, { method: 'POST', headers: json, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!signed.ok) return signed;
  const out = (await signed.clone().json()) as { status: string; url?: string };
  if (out.status === 'duplicate') return signed;
  const put = await fetch(out.url!, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' }, body: blob, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (!put.ok) return put;
  return fetch(`/api/d/${token}/photos/finish`, { method: 'POST', headers: json, body, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
}

export type FlushResult = 'idle' | 'synced' | 'offline' | 'dead' | 'partial';

export async function flush(token: string, onStart?: () => void): Promise<FlushResult> {
  if (flushing) return 'idle';
  flushing = true;
  try {
    const d = await db();
    const actions = ((await d.getAll('actions')) as StoredAction[]).filter((a) => a.token === token);
    const photos = ((await d.getAll('photos')) as StoredPhoto[]).filter((p) => p.token === token);
    if (!actions.length && !photos.length) return 'synced';
    onStart?.();

    for (let i = 0; i < actions.length; i += 50) {
      const batch = actions.slice(i, i + 50);
      const res = await fetch(`/api/d/${token}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions: batch.map((a) => a.action) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status === 410) return 'dead';
      if (!res.ok) return 'partial';
      const { acks } = (await res.json()) as { acks: { client_uuid: string; status: string; reason?: string }[] };
      for (const a of batch) {
        const ack = acks.find((x) => x.client_uuid === a.action.client_uuid);
        if (!ack) continue;
        // A rejected action is kept aside, never silently dropped.
        if (ack.status === 'rejected') await d.put('rejected', { client_uuid: ack.client_uuid, reason: ack.reason, action: a.action });
        await d.delete('actions', a.seq!);
      }
    }

    let waiting = false;
    for (const p of photos) {
      const res = await sendPhoto(token, p);
      if (res.status === 410) return 'dead';
      if (res.ok) {
        await d.delete('photos', p.client_uuid);
      } else if ([413, 415, 422].includes(res.status)) {
        // The server will never take this file. Keep it on the phone, but stop it holding up the badge.
        await d.put('rejected', { ...p, reason: `photo ${res.status}` });
        await d.delete('photos', p.client_uuid);
      } else {
        waiting = true;
      }
    }
    return waiting ? 'partial' : 'synced';
  } catch {
    return 'offline';
  } finally {
    flushing = false;
  }
}
