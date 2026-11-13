import { createHash } from 'node:crypto';

export interface ProofSnapshot {
  id: string;
  source: string;
  request_url: string;
  fetched_at: string;
  last_modified: string | null;
  sha256: string;
  summary: Record<string, unknown>;
}

export interface ProofPhoto {
  id: string;
  phase: string;
  storage_path: string;
  sha256: string;
  taken_device_at: string | null;
  received_at: string;
}

export interface ProofVisit {
  id: string;
  storm_id: string;
  crew_name: string;
  arrived_device_at: string;
  arrived_received_at: string;
  departed_device_at: string | null;
  departed_received_at: string | null;
  arrive_lat: number | null;
  arrive_lon: number | null;
  arrive_acc_m: number | null;
  services: string[];
  salt: unknown;
  depth_in: number | null;
  is_replow: boolean;
  gps_match: boolean | null;
  photos: ProofPhoto[];
}

export interface ProofInput {
  contractor: { name: string; timezone: string };
  customer: { name: string };
  site: { id: string; label: string; address: string; lat: number; lon: number };
  period: { from: string; to: string };
  contract: { season: string; services: unknown; salt_pricing: unknown; terms_md: string | null; accepted_at: string | null; accepted_name: string | null } | null;
  storms: { id: string; name: string; started_at: string; closed_at: string | null; snapshots: ProofSnapshot[] }[];
  visits: ProofVisit[];
  messages: { id: string; channel: string; template: string; body: string; created_at: string; status: string | null }[];
  corrections: { id: string; visit_id: string; field: string; old_value: unknown; new_value: unknown; reason: string; created_at: string }[];
}

export type ProofManifest = ProofInput & { version: 1; caveat: string };

export const WEATHER_CAVEAT =
  'Forecast values are National Weather Service gridded forecasts as retrieved at the time shown; observed totals are NOHRSC analyses, which may be revised for up to 5 days.';

const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

/** Key-sorted JSON so the same logical content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const body = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Orders everything deterministically and contains no generated-at time, so inputs fully determine the hash. */
export function buildManifest(input: ProofInput): { manifest: ProofManifest; hash: string } {
  const manifest: ProofManifest = {
    ...input,
    version: 1,
    caveat: WEATHER_CAVEAT,
    storms: [...input.storms]
      .sort(byKey((s) => `${s.started_at}|${s.id}`))
      .map((s) => ({ ...s, snapshots: [...s.snapshots].sort(byKey((x) => `${x.fetched_at}|${x.id}`)) })),
    visits: [...input.visits]
      .sort(byKey((v) => `${v.arrived_device_at}|${v.id}`))
      .map((v) => ({ ...v, photos: [...v.photos].sort(byKey((p) => `${p.phase}|${p.id}`)) })),
    messages: [...input.messages].sort(byKey((m) => `${m.created_at}|${m.id}`)),
    corrections: [...input.corrections].sort(byKey((c) => `${c.created_at}|${c.id}`)),
  };
  return { manifest, hash: createHash('sha256').update(canonicalJson(manifest)).digest('hex') };
}

const PHASE_RANK: Record<string, number> = { before: 0, after: 1, issue: 2 };

/**
 * The order photos are shown in anywhere a person reads them (records page, proof packet, completion email): before,
 * then after, then issue photos, each by when it was taken. The database returns them in no particular order.
 */
export function photoOrder<P extends { phase: string | null; taken_device_at?: string | Date | null; id: string }>(a: P, b: P): number {
  const rank = (p: P) => PHASE_RANK[p.phase ?? ''] ?? 3;
  const time = (p: P) => (p.taken_device_at ? new Date(p.taken_device_at).getTime() : Number.MAX_SAFE_INTEGER);
  return rank(a) - rank(b) || time(a) - time(b) || a.id.localeCompare(b.id);
}
