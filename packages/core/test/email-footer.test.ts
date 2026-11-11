import { describe, expect, it } from 'vitest';
import { emailFooter } from '../src/messages';

const co = { name: "Flip's Plowing (Demo)", phone: '+12165550100', email: 'office@example.com', address: '100 Example St, Lakewood, OH 44107' };

describe('every email says who sent it and how to stop', () => {
  it('a customer email names the company, its address and contact, and how to stop', () => {
    const f = emailFooter('on_the_way', co);
    expect(f.startsWith('\n\n--\n')).toBe(true);
    expect(f).toContain("Flip's Plowing (Demo)");
    expect(f).toContain('100 Example St, Lakewood, OH 44107');
    expect(f).toContain('(216) 555-0100 | office@example.com');
    expect(f).toMatch(/To stop these emails, reply/);
    expect(f).toContain('Sent with Flake');
  });
  it('crew and office emails say why they got it in their own terms', () => {
    expect(emailFooter('crew_link', co)).toMatch(/on Flip's Plowing \(Demo\)'s crew/);
    expect(emailFooter('owner_alert', co)).toMatch(/team in Flake/);
  });
  it('leaves out what the company has not entered, without blank lines', () => {
    const f = emailFooter('invoice', { name: 'Bare Co' });
    expect(f).not.toMatch(/\n\n\n|undefined|null/);
    expect(f.split('\n').slice(3, 5)).toEqual(['Bare Co', expect.stringMatching(/^You get these/)]);
  });
  it('salt supplier emails are from Flake itself', () => {
    expect(emailFooter('salt_supplier', co)).toMatch(/Sent by Flake \(216LABS\)/);
  });
});
