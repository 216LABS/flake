import { randomUUID } from 'node:crypto';
import { serviceDb, sql, tenant, eq } from '@flake/db';
import { log } from './log';
import { sendEmail } from './messaging';
import { getSetting } from './providers';

const KEY = 'feedback';
/** The newest this many are kept; the email is the lasting copy. */
const KEEP = 500;

export interface Feedback { id: string; at: string; tenant_id: string; company: string; email: string | null; role: string; path: string; message: string }

/**
 * Feedback from inside the app (the pilot's "this was confusing"), for 216LABS. Kept in the database first, so nothing is
 * lost if email isn't set up, then emailed to ADMIN_EMAILS with a reply-to of the person who sent it.
 */
export async function saveFeedback(f: Omit<Feedback, 'id' | 'at'>): Promise<Feedback> {
  const entry: Feedback = { id: randomUUID(), at: new Date().toISOString(), ...f };
  await serviceDb().execute(sql`
    insert into app_setting (key, value) values (${KEY}, ${JSON.stringify({ entries: [entry] })}::jsonb)
    on conflict (key) do update set value = jsonb_build_object('entries',
      (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(${JSON.stringify([entry])}::jsonb || coalesce(app_setting.value->'entries', '[]'::jsonb)) e limit ${KEEP}) x))`);
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, f.tenant_id));
  for (const to of admins) {
    try {
      await sendEmail(t!, {
        to, template: 'feedback', subject: `Flake feedback from ${f.company}`, fromName: 'Flake feedback', replyTo: f.email,
        text: `${f.message}\n\nFrom: ${f.email ?? 'unknown'} (${f.role}) at ${f.company}\nPage: ${f.path}\nSent: ${entry.at}`,
        key: `feedback:${entry.id}:${to}`,
        internal: true,
      });
    } catch (err) {
      // Saved above; the admin page shows it even when the email didn't go.
      log.error('feedback email failed', err, { tenant_id: f.tenant_id });
    }
  }
  return entry;
}

export async function listFeedback(): Promise<Feedback[]> {
  return ((await getSetting<{ entries?: Feedback[] }>(KEY))?.entries ?? []);
}
