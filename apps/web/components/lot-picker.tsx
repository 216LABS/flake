'use client';

import { Badge, Button, cn } from '@flake/ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LotOption } from '@/lib/lots';
import { usDistanceText } from '@flake/core/units';

type Filter = 'all' | 'unrouted' | 'nocontract';
const RECENT_KEY = 'flake.recentLots';

const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const remember = (ids: string[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set([...ids, ...readRecent()])].slice(0, 8)));
  } catch {
    // Private mode: no recent list, nothing else changes.
  }
};

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Find a lot by typing any part of its name, street, city or customer (issue 193): a long plain list was a scroll on a
 * desk and a giant wheel on a phone. Filters for lots on no route or with no contract, by route and by city. Adding to a
 * route or truck sorts nearest first. An ARIA combobox: arrows move, Enter picks, Esc closes.
 */
export function LotPicker({ lots, exclude = [], onPick, multi = false, near, defaultFilter = 'all', label, placeholder = 'Search by lot, street, city or customer', testId = 'lot-picker', className }: {
  lots: LotOption[]; exclude?: string[]; onPick: (ids: string[]) => void; multi?: boolean; near?: { lat: number; lon: number }[]; defaultFilter?: Filter;
  label: string; placeholder?: string; testId?: string; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [routeName, setRouteName] = useState('');
  const [city, setCity] = useState('');
  const [active, setActive] = useState(0);
  const [ticked, setTicked] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setRecent(readRecent()), [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pool = useMemo(() => lots.filter((l) => !exclude.includes(l.id)), [lots, exclude]);
  const routes = useMemo(() => [...new Set(pool.flatMap((l) => l.routes))].sort(), [pool]);
  const cities = useMemo(() => [...new Set(pool.map((l) => l.city).filter(Boolean))].sort(), [pool]);
  const unroutedCount = pool.filter((l) => !l.routes.length).length;
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = pool.filter((l) => {
      const hay = `${l.label} ${l.address} ${l.customer} ${l.city}`.toLowerCase();
      return words.every((w) => hay.includes(w))
        && (filter !== 'unrouted' || !l.routes.length)
        && (filter !== 'nocontract' || !l.contracted)
        && (!routeName || l.routes.includes(routeName))
        && (!city || l.city === city);
    });
    if (near?.length) {
      const d = (l: LotOption) => Math.min(...near.map((n) => km(n, l)));
      list = [...list].sort((a, b) => d(a) - d(b));
    }
    if (!words.length && recent.length) list = [...list.filter((l) => recent.includes(l.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)), ...list.filter((l) => !recent.includes(l.id))];
    return list.slice(0, 60);
  }, [pool, q, filter, routeName, city, near, recent]);
  useEffect(() => setActive(0), [q, filter, routeName, city]);

  const choose = (lotId: string) => {
    if (multi) return setTicked((t) => (t.includes(lotId) ? t.filter((x) => x !== lotId) : [...t, lotId]));
    remember([lotId]);
    onPick([lotId]);
    setQ('');
    setOpen(false);
  };
  const addTicked = () => {
    remember(ticked);
    onPick(ticked);
    setTicked([]);
    setQ('');
    setOpen(false);
  };
  const near1 = near?.length ? (l: LotOption) => Math.min(...near.map((n) => km(n, l))) : null;
  const chip = (on: boolean) => cn('min-h-9 rounded-full border px-3 text-xs font-semibold', on ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink hover:border-ink');

  return (
    <div ref={box} className={cn('relative', className)} data-testid={testId}>
      <label htmlFor={`${id}-q`} className="sr-only">{label}</label>
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={`${id}-q`} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && shown[active] ? `${id}-${shown[active]!.id}` : undefined}
          className="h-11 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-base text-ink placeholder:text-faint focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/15 md:h-10 md:text-sm"
          placeholder={placeholder} value={q} data-testid={`${testId}-input`}
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); choose(shown[active]!.id); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open ? (
        // Opens in place, pushing what's below down, so a card or lane can never clip it.
        <div className="mt-1 rounded-control border border-line bg-surface shadow-popup">
          <div className="flex flex-wrap gap-1.5 border-b border-line-faint p-2" role="group" aria-label="Filters">
            <button type="button" className={chip(filter === 'all')} onClick={() => setFilter('all')}>All</button>
            <button type="button" className={chip(filter === 'unrouted')} data-testid={`${testId}-unrouted`} onClick={() => setFilter('unrouted')}>Not on a route ({unroutedCount})</button>
            <button type="button" className={chip(filter === 'nocontract')} onClick={() => setFilter('nocontract')}>No contract</button>
            {routes.length ? <select aria-label="On route" className="min-h-9 rounded-full border border-line bg-surface px-2 text-xs font-semibold" value={routeName} onChange={(e) => setRouteName(e.target.value)}><option value="">Any route</option>{routes.map((r) => <option key={r} value={r}>{r}</option>)}</select> : null}
            {cities.length > 1 ? <select aria-label="City" className="min-h-9 rounded-full border border-line bg-surface px-2 text-xs font-semibold" value={city} onChange={(e) => setCity(e.target.value)}><option value="">Any city</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select> : null}
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="max-h-80 overflow-y-auto py-1">
            {shown.map((l, i) => {
              const on = ticked.includes(l.id);
              return (
                <li key={l.id} id={`${id}-${l.id}`} role="option" aria-selected={multi ? on : i === active} data-testid={`${testId}-option`} data-lot-id={l.id}
                  className={cn('flex cursor-pointer items-start gap-2 px-3 py-2 text-sm', i === active && 'bg-tint-2')}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(l.id)}>
                  {multi ? <input type="checkbox" tabIndex={-1} readOnly checked={on} className="mt-1 size-4" aria-hidden="true" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{l.label}</span>
                    <span className="block text-xs text-muted">{l.address}{l.customer && !l.label.includes(l.customer) ? ` · ${l.customer}` : ''}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {l.routes.length ? l.routes.map((r) => <Badge key={r}>On {r}</Badge>) : <Badge tone="blue">Not on a route</Badge>}
                      {l.contracted ? null : <Badge tone="amber">No contract</Badge>}
                      {l.priority === 1 ? <Badge tone="red">Priority 1</Badge> : null}
                      {recent.includes(l.id) && !q ? <Badge>Recent</Badge> : null}
                    </span>
                  </span>
                  {near1 ? <span className="shrink-0 text-xs text-muted">{usDistanceText(near1(l) * 1000)}</span> : null}
                </li>
              );
            })}
            {!shown.length ? <li className="px-3 py-3 text-sm text-muted" role="option" aria-selected={false} aria-disabled>No lots match.</li> : null}
          </ul>
          {multi ? (
            <div className="flex items-center justify-between gap-2 border-t border-line-faint p-2">
              <span className="text-xs text-muted">{ticked.length ? `${ticked.length} picked` : 'Tick the lots to add'}</span>
              <Button size="sm" variant="accent" disabled={!ticked.length} data-testid={`${testId}-add`} onClick={addTicked}>{ticked.length === 1 ? 'Add 1 lot' : `Add ${ticked.length} lots`}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
