import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue 201: the office stopped being a page of blue underlines. Names use entityLink (underline on hover), actions are
 * buttons, filters are tabs, links inside sentences use proseLink. All of those live in components/links.tsx, so a bare
 * always-on `underline` class anywhere in the office app is a stray.
 */
const ROOT = join(__dirname, '..', 'app', '(app)');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** `underline` as its own class, not hover:underline, underline-offset-2 or decoration-*. */
const BARE = /(?<![\w:-])underline(?![\w-])/;

describe('office link style', () => {
  it('has no always-on underlines outside the shared link helpers', () => {
    const strays: string[] = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
          const cls = m[1] ?? m[2] ?? m[3] ?? '';
          if (BARE.test(cls)) strays.push(`${relative(ROOT, f)}:${i + 1}  ${cls}`);
        }
      });
    }
    expect(strays).toEqual([]);
  });
});
