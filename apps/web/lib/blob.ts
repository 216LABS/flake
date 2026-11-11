import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { required } from './env';

export type Bucket = 'photos' | 'proof' | 'contracts' | 'weather-archive';
export const SIGNED_URL_TTL_S = 600;

let client: SupabaseClient | null = null;
/** Service-role client for Storage and auth admin. Server only. All buckets are private. */
export function adminClient(): SupabaseClient {
  client ??= createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export async function putBlob(bucket: Bucket, path: string, data: Uint8Array, contentType: string, opts: { upsert?: boolean } = {}) {
  const { error } = await adminClient().storage.from(bucket).upload(path, data, { contentType, upsert: opts.upsert ?? false });
  if (error) throw new Error(`Storage upload to ${bucket} failed: ${error.message}`);
}

/** A short-lived URL the phone can PUT one file to. Only this path, and the bucket stays private. */
export async function signedUploadUrl(bucket: Bucket, path: string): Promise<string> {
  const { data, error } = await adminClient().storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(`Could not sign an upload to ${bucket}: ${error?.message}`);
  return data.signedUrl;
}

export async function getBlob(bucket: Bucket, path: string): Promise<Uint8Array | null> {
  const { data, error } = await adminClient().storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeBlob(bucket: Bucket, path: string) {
  await adminClient().storage.from(bucket).remove([path]);
}

export async function signedUrl(bucket: Bucket, path: string, downloadName?: string): Promise<string | null> {
  const { data } = await adminClient().storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_S, downloadName ? { download: downloadName } : undefined);
  return data?.signedUrl ?? null;
}
