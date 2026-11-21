/**
 * A link the office texts from its own phone (D16): Flake sends nothing, the office's Messages app opens with the
 * customer's number and a ready message. Safe in the browser and on the server.
 */
export interface Share { text: string; phone: string | null }

export const quoteShare = (company: string, url: string, phone: string | null, lots = 1): Share => ({
  text: `${company}: your snow plowing quote${lots > 1 ? ` for ${lots} properties` : ''} is ready. Review and sign it here: ${url}`,
  phone,
});

export const recordsShare = (company: string, url: string, phone: string | null): Share => ({
  text: `${company}: your snow plowing visits, photos and bills are on this page: ${url}`,
  phone,
});

/** iPhones read `&body=` after a number (or none); Android reads `?body=`. */
export function smsHref(phone: string | null | undefined, body: string, ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  return `sms:${phone ?? ''}${/iPhone|iPad|iPod|Macintosh/.test(ua) ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
