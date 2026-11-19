import { describe, expect, it } from 'vitest';
import { normalizeName, qboKeyFor, suggestQboMatches } from '../src/qbo';

describe('issue 162: QuickBooks customer matching', () => {
  it('matches by normalized name, then by email, and never guesses between two', () => {
    const qbo = [
      { id: '1', name: 'Lakewood Medical Center, LLC', email: null },
      { id: '2', name: 'Birds & Bees Inc.', email: 'office@example.com' },
      { id: '3', name: 'Twin Plaza', email: null },
      { id: '4', name: 'twin plaza', email: null },
      { id: '5', name: 'Some Other Name', email: 'pat@example.com' },
    ];
    const flake = [
      { id: 'a', name: 'Lakewood Medical Center', email: null },
      { id: 'b', name: 'Birds and Bees', email: null },
      { id: 'c', name: 'Twin Plaza', email: null },
      { id: 'd', name: 'Pat Jones', email: 'PAT@example.com ' },
      { id: 'e', name: 'Nobody', email: 'nobody@example.com' },
    ];
    const m = suggestQboMatches(flake, qbo);
    expect(m.get('a')).toEqual({ qboId: '1', by: 'name' });
    expect(m.get('b')).toEqual({ qboId: '2', by: 'name' });
    expect(m.has('c')).toBe(false);
    expect(m.get('d')).toEqual({ qboId: '5', by: 'email' });
    expect(m.has('e')).toBe(false);
  });
  it('normalizes names and maps services to items', () => {
    expect(normalizeName('The  Corner Co.')).toBe('corner');
    expect(qboKeyFor('plow')).toBe('plow');
    expect(qboKeyFor('fee')).toBe('other');
  });
});
