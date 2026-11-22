import { describe, expect, it } from 'vitest';
import { quoteShare, recordsShare, smsHref } from '@/lib/share';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

describe('D21: texting a customer link from the office phone', () => {
  it('uses &body= on an iPhone and ?body= on Android, with the number when there is one', () => {
    expect(smsHref('+12165550142', 'hi', IPHONE)).toBe('sms:+12165550142&body=hi');
    expect(smsHref('+12165550142', 'hi', ANDROID)).toBe('sms:+12165550142?body=hi');
    expect(smsHref(null, 'hi', ANDROID)).toBe('sms:?body=hi');
  });

  it('encodes the message, so a link with & and ? arrives whole', () => {
    const href = smsHref(null, 'See https://x.test/q/a?b=1&c=2 now', ANDROID);
    expect(decodeURIComponent(href.split('body=')[1]!)).toBe('See https://x.test/q/a?b=1&c=2 now');
  });

  it('names the company and the link, and says when one quote covers several properties', () => {
    expect(quoteShare('North Coast Snow', 'https://f.test/q/x', '+12165550142')).toEqual({ text: 'North Coast Snow: your snow plowing quote is ready. Review and sign it here: https://f.test/q/x', phone: '+12165550142' });
    expect(quoteShare('North Coast Snow', 'https://f.test/q/x', null, 3).text).toContain('quote for 3 properties');
    expect(recordsShare('North Coast Snow', 'https://f.test/c/y', null).text).toBe('North Coast Snow: your snow plowing visits, photos and bills are on this page: https://f.test/c/y');
  });
});
