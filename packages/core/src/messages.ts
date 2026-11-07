/** SMS templates from ADDENDUM_SMS section 4: company name first, two segments at most. */
export type TemplateKey = 'team_invite' | 'receipt' | 'crew_link' | 'call_out' | 'on_the_way' | 'done' | 'late' | 'invoice' | 'help' | 'route_changed' | 'quote' | 'owner_alert' | 'crew_invite';

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
  const word = body.trim().toUpperCase();
  if (STOP.has(word)) return 'stop';
  if (word === 'HELP' || word === 'INFO') return 'help';
  if (optedOut && START.has(word)) return 'start';
  if (word === 'START' || word === 'UNSTOP') return 'start';
  if (word === 'YES' || word === 'Y') return 'yes';
  if (word === 'NO' || word === 'N') return 'no';
  return 'other';
}

/** Invoice texts go out only 8 AM to 8 PM local. Storm and service notices have no quiet hours. */
export function inInvoiceHours(hm: string): boolean {
  return hm >= '08:00' && hm < '20:00';
}
