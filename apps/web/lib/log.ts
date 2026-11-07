type Fields = { tenant_id?: string; job_id?: number; [k: string]: unknown };

/** Structured logs. Callers pass ids and kinds only, never tokens or message bodies. */
export const log = {
  info: (msg: string, fields: Fields = {}) => console.log(JSON.stringify({ level: 'info', msg, ...fields })),
  error: (msg: string, err: unknown, fields: Fields = {}) =>
    console.error(JSON.stringify({ level: 'error', msg, error: err instanceof Error ? err.message : String(err), ...fields })),
};
