/** SMS templates from ADDENDUM_SMS section 4: company name first, two segments at most. */
/** Who an email is for decides why the footer says they got it. */
const AUDIENCE: Record<string, 'customer' | 'crew' | 'office' | 'flake'> = {
  on_the_way: 'customer', done: 'customer', late: 'customer', invoice: 'customer', receipt: 'customer', quote: 'customer', portal: 'customer', completion_report: 'customer', help: 'customer',
  crew_link: 'crew', route_changed: 'crew', crew_invite: 'crew', call_out: 'crew',
  owner_alert: 'office', team_invite: 'office',
  salt_supplier: 'flake',
};

/**
 * The bottom of every email: who it's from, how to reach them, their mailing address when the company has entered one,
 * why the reader is getting it, and how to stop. Plain text, like the rest of the email.
 */
export function emailFooter(template: string, c: { name: string; phone?: string | null; email?: string | null; address?: string | null }) {
  const who = AUDIENCE[template] ?? 'customer';
  if (who === 'flake') return '\n\n--\nSent by Flake (216LABS) for salt orders placed through it. Reply to this email with any question.';
  const phone = c.phone && /^\+1\d{10}$/.test(c.phone) ? `(${c.phone.slice(2, 5)}) ${c.phone.slice(5, 8)}-${c.phone.slice(8)}` : c.phone;
  const contact = [phone, c.email].filter(Boolean).join(' | ');
  const why = {
    customer: `You get these because ${c.name} provides snow service at your property. To stop these emails, reply and ask ${c.name} to turn them off.`,
    crew: `You get these because you're on ${c.name}'s crew. To stop them, ask ${c.name} to take you off.`,
    office: `You get these because you're on ${c.name}'s team in Flake. An owner can change who gets them in Settings.`,
  }[who];
  const lines = [c.name, c.address, contact, why, 'Sent with Flake: https://flake.216labs.dev'].filter((x): x is string => Boolean(x));
  return `\n\n--\n${lines.join('\n')}`;
}

export type TemplateKey = 'team_invite' | 'receipt' | 'crew_link' | 'call_out' | 'on_the_way' | 'done' | 'late' | 'invoice' | 'help' | 'route_changed' | 'quote' | 'owner_alert' | 'crew_invite' | 'portal';

const TEMPLATES: Record<TemplateKey, string> = {
  crew_link: '{company}: Storm on. Route {route} - {n} stops. Start: {link} Reply STOP to opt out.',
  call_out: '{company}: Plowing expected ~{time}. Can you run {route}? Reply YES or NO.',
  on_the_way: '{company}: Your plow is on the way to {site}.',
  done: '{company}: {site} cleared at {time}. Photo: {link}',
  late: '{company}: Heavy snow is slowing routes. We expect to reach {site} by {time}.',
  invoice: '{company}: Invoice for {storm} - ${amount}. View/pay: {link}',
  receipt: '{company}: Paid. {storm} - ${amount}, charged to the payment method on file.',
  help: '{company} service texts via Flake. Contact {phone}. Reply STOP to opt out.',
  route_changed: '{company}: Your route changed. Open your link to see it: {link}',
  quote: '{company}: Your snow service quote is ready. Review and accept: {link}',
  owner_alert: 'Flake: {headline} Review: {link}',
  crew_invite: '{company} invited you to get route links. Join: {link}',
  team_invite: '{company} added you to Flake. Sign in with this email: {link}',
  portal: '{company}: Your snow service records, with every visit and photo: {link}',
};

export function renderTemplate(key: TemplateKey, vars: Record<string, string | number>): string {
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Template ${key} is missing {${name}}`);
    return String(vars[name]);
  });
}

export const CREW_CONSENT_TEXT = (company: string) =>
  `Text me route links and storm call-outs from ${company}. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
export const CUSTOMER_CONSENT_TEXT = (company: string) =>
  `Text me service updates (on the way, completed with photo, invoices) from ${company}. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;

const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START = new Set(['START', 'YES', 'UNSTOP']);

export type InboundKind = 'stop' | 'start' | 'help' | 'yes' | 'no' | 'other';

/** YES doubles as Twilio's opt-back-in word, so it's only a call-out reply when the number is opted in. */
export function classifyInbound(body: string, optedOut: boolean): InboundKind {
  // People type "No." and "yes!". Only the whole message counts, because "no problem" means yes.
  const word = body.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (STOP.has(word)) return 'stop';
  if (word === 'HELP' || word === 'INFO') return 'help';
  if (optedOut && START.has(word)) return 'start';
  if (word === 'START' || word === 'UNSTOP') return 'start';
  if (['YES', 'Y', 'YEP', 'YEAH', 'YUP', 'OK', 'OKAY', 'SURE'].includes(word)) return 'yes';
  if (['NO', 'N', 'NOPE'].includes(word)) return 'no';
  return 'other';
}

/** Invoice texts go out only 8 AM to 8 PM local. Storm and service notices have no quiet hours. */
export function inInvoiceHours(hm: string): boolean {
  return hm >= '08:00' && hm < '20:00';
}
