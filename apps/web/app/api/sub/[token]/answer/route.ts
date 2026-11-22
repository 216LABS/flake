import { subAnswer } from '@flake/contracts';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { answerStatement, resolveSubPortal } from '@/lib/subs';

/** The sub's answer to a statement, from its portal: it looks right, or a line is wrong and why. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  await rateLimit(`sub-answer:${clientIp(req)}`, 30, 60_000);
  const who = await resolveSubPortal((await params).token);
  if (!who) throw new HttpError(404, 'This link has been turned off. Ask the office for a new one.');
  const b = await parseJson(req, subAnswer);
  if (b.to < b.from) throw new HttpError(422, 'The dates are backwards.');
  return answerStatement(who.sub, b.from, b.to, b);
});
