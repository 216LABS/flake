import { z } from 'zod';
import { supabaseServer } from '@/lib/auth';
import { demoLoginEnabled, isProd } from '@/lib/env';
import { HttpError, parseJson, route } from '@/lib/http';

/** Signs in as a seeded demo user. Local and test only; /dev and /api/dev return 404 in production. */
export const POST = route(async (req) => {
  if (isProd() || !demoLoginEnabled()) throw new HttpError(404, 'Not found');
  const { email } = await parseJson(req, z.object({ email: z.email() }));
  if (!email.endsWith('@flake.test')) throw new HttpError(403, 'Demo accounts only');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password: 'flake-demo-only' });
  if (error) throw new HttpError(401, 'Run pnpm seed:demo first');
  return { ok: true };
});
