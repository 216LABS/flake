/**
 * Street addresses as people type them and as geocoders return them (issues 206 and 210). A lot keeps one tidy form,
 * "14600 Detroit Ave, Lakewood, OH 44107", however it came in, so its city (its service area) and its name read the
 * same on every screen. Nothing here is tuned to one region.
 */

const SUFFIX: Record<string, string> = {
  ave: 'avenue', av: 'avenue', rd: 'road', st: 'street', dr: 'drive', blvd: 'boulevard', ln: 'lane', ct: 'court', pl: 'place',
  pkwy: 'parkway', hwy: 'highway', cir: 'circle', ter: 'terrace', trl: 'trail', sq: 'square', plz: 'plaza', n: 'north', s: 'south', e: 'east', w: 'west',
};
const DIRECTIONS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);
/** Words that end a street name, so what follows them in "12700 Lake Ave Lakewood OH" is the city. */
const STREET_END = new Set([
  ...Object.entries(SUFFIX).filter(([k]) => !DIRECTIONS.has(k)).flat(),
  'way', 'mall', 'pike', 'row', 'loop', 'run', 'crossing', 'xing', 'expy', 'expressway', 'fwy', 'freeway', 'tpke', 'turnpike', 'center', 'ctr',
]);
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));
const ZIP = /^\d{5}(-\d{4})?$/;
const STATE_NAMES: Record<string, string> = Object.fromEntries(Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
}).map(([code, name]) => [name.toLowerCase(), code]));

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/[.,]/g, '');

/** "LAKEWOOD" and "lakewood" read "Lakewood"; "14600 DETROIT RD NW" reads "14600 Detroit Rd NW". Mixed case is kept. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return words(s).map((w) => (DIRECTIONS.has(bare(w)) && bare(w).length <= 2 ? w.toUpperCase() : w.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/^([A-Z]')([a-z])/, (_, a: string, b: string) => a + b.toUpperCase()))).join(' ');
}

/** A street to compare: lower case, suffixes and directions spelled out, the city and anything in brackets dropped. */
export function streetKey(s: string): string {
  return words((s.replace(/\(.*?\)/g, ' ').split(',')[0]!).toLowerCase().replace(/[.#]/g, ' ')).map((w) => SUFFIX[w] ?? w).join(' ');
}
/** "14701 Detroit Ave" and "14701 DETROIT AVENUE" are the same street. "14701 DETROIT RD" is not. */
export const sameStreet = (typed: string, found: string) => streetKey(typed) === streetKey(found);
/** What was typed so far is the start of that street: "14600 Detr" fits "14600 Detroit Avenue", "1 Cascade Plaza" doesn't fit "1 Cascade St". */
export function streetFits(typed: string, found: string): boolean {
  const t = streetKey(typed);
  const f = streetKey(found);
  if (!t) return true;
  if (f === t) return true;
  const tw = t.split(' ');
  const fw = f.split(' ');
  // Every typed word but the last matches in full; the last can be half typed.
  return tw.length <= fw.length && tw.every((w, i) => (i === tw.length - 1 ? fw[i]!.startsWith(w) : fw[i] === w));
}

export type Place = { street: string; city: string; state: string; zip: string };

/** Splits "14600 DETROIT RD, LAKEWOOD, OH, 44107" or "14600 Detroit Avenue, Lakewood, OH 44107, United States". */
export function parsePlace(label: string): Place {
  const parts = label.replace(/\(.*?\)/g, ' ').split(',').map((p) => p.trim()).filter(Boolean);
  let state = '';
  let zip = '';
  let city = '';
  for (const p of parts.slice(1)) {
    // ZIP and state come off the end of a part ("Lakewood OH 44107", "OH, 44107"); what's left first is the city.
    const ws = words(p);
    for (let last = ws.at(-1); last !== undefined; last = ws.at(-1)) {
      if (ZIP.test(last)) zip ||= last;
      else if (STATES.has(last.toUpperCase()) && (last === last.toUpperCase() || ws.length === 1)) state ||= last.toUpperCase();
      else break;
      ws.pop();
    }
    const rest = ws.join(' ');
    const named = STATE_NAMES[rest.toLowerCase()];
    // A whole part that's a state's name ("Pennsylvania 15213") is the state, unless no city has come yet ("New York, NY").
    if (named && (city || state)) {
      state ||= named;
      continue;
    }
    if (rest && !city && !/^(united states|usa|us)$/i.test(rest)) city = rest;
  }
  return { street: parts[0] ?? '', city, state, zip };
}

/**
 * The city from a saved address: the second part of "123 Main St, Lakewood, OH 44107", or, for an address saved before
 * imports were tidied, the words between the street and the state in "12700 Lake Ave Lakewood OH". '' when unclear.
 */
export function cityOf(address: string): string {
  if (address.includes(',')) return titleCase(parsePlace(address).city);
  const ws = words(address);
  let end = ws.length;
  if (end && ZIP.test(ws[end - 1]!)) end--;
  if (!end || !STATES.has(ws[end - 1]!.toUpperCase())) return '';
  end--;
  let last = -1;
  for (let i = 1; i < end; i++) if (STREET_END.has(bare(ws[i]!))) last = i;
  if (last < 0) return '';
  let start = last + 1;
  while (start < end && DIRECTIONS.has(bare(ws[start]!))) start++;
  return start < end ? titleCase(ws.slice(start, end).join(' ')) : '';
}

/** The street as typed, without the city, state and ZIP the geocoder found. '' when the city can't be told apart. */
function typedStreet(typed: string, found: Place): string {
  if (typed.includes(',')) return typed.split(',')[0]!.trim();
  const ws = words(typed);
  let end = ws.length;
  if (end && ZIP.test(ws[end - 1]!)) end--;
  if (end && STATES.has(ws[end - 1]!.toUpperCase())) end--;
  const city = words(found.city).map(bare);
  if (end > city.length && ws.slice(end - city.length, end).map(bare).join(' ') === city.join(' ')) return ws.slice(0, end - city.length).join(' ');
  // Just a street, typed in full ("1470 Detroit Rd"): no state or ZIP, and it ends the way streets end.
  return end === ws.length && end > 1 && STREET_END.has(bare(ws[end - 1]!)) ? ws.join(' ') : '';
}

/**
 * One tidy address from what was typed and what the geocoder matched: the typed street when the match is a different
 * street (the office knows its lots; the point is still the geocoder's), else the matched street, then the matched
 * city, state and ZIP. With no city in the match, what was typed is kept.
 */
export function tidyAddress(typed: string, found: string): string {
  const f = parsePlace(found);
  if (!f.city) return typed.trim();
  const t = typedStreet(typed, f);
  const street = t && !streetFits(t, f.street) ? t : titleCase(f.street);
  return [street, titleCase(f.city), [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
