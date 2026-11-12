'use client';

import { feet } from '@flake/core/units';
import { Badge, Button } from '@flake/ui';
import { X } from 'lucide-react';
import { useModal } from '@/components/use-modal';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/client';

interface Photo { id: string; phase: string | null; taken_at: string | null; received_at: string | null }
interface Visit {
  id: string; crew: string | null; arrived_at: string; departed_at: string | null; services: string[]; depth_in: number | null;
  salt: { unit: string; qty: number }[] | null; notes: string | null; replow: boolean; voided: boolean;
  gps: { lat: number; lon: number; accuracy_m: number | null; matched: boolean | null } | null; photos: Photo[];
}
interface Detail {
  id: string; status: string; seq: number;
  storm: { name: string; status: string };
  site: { label: string; address: string | null; open_by: string | null; priority: number };
  customer: { name: string };
  run: { name: string; pass: number; crew: string | null };
  visits: Visit[];
  problems: { id: string; kind: string | null; note: string | null; at: string | null; resolved_at: string | null }[];
}

const STATUS_WORD: Record<string, string> = { open: 'Open', enroute: 'On the way', onsite: 'On site', done: 'Done', skipped: 'Skipped', problem: 'Problem' };
const PHASE: Record<string, string> = { before: 'Before', after: 'After', issue: 'Problem' };
const SALT_UNIT: Record<string, string> = { bag50lb: 'bags (50 lb)', lb: 'lb', ton: 'tons', application: 'applications' };

const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : null);

/**
 * One stop, opened from the storm board (issue 41): who did it and when, what they logged, where the phone was, any
 * problem, and the photos. A sheet from the bottom on a phone, a panel on a desk. It re-reads when opened, so a photo
 * that synced a moment ago is there.
 */
export function StopSheet({ stopId, tz, onClose }: { stopId: string; tz: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState<Photo | null>(null);
  const titleId = useId();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useModal(sheet, { initial: closeBtn });
  useEffect(() => {
    let live = true;
    setD(null);
    setError(null);
    api<Detail>(`/api/run-stops/${stopId}`).then((x) => live && setD(x), (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [stopId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (big) setBig(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, big]);

  const photos = d?.visits.flatMap((v) => v.photos) ?? [];
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 sm:items-stretch sm:justify-end" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="stop-sheet" className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl sm:max-h-none sm:max-w-md sm:rounded-none">
        <div className="flex items-start gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-semibold leading-tight">{d ? d.site.label : 'Stop'}</h2>
            {d ? <p className="text-sm text-slate-600">{d.customer.name}{d.site.address ? `, ${d.site.address}` : ''}</p> : null}
          </div>
          <Button ref={closeBtn} variant="ghost" size="sm" className="h-10 w-10 shrink-0 p-0" aria-label="Close" data-testid="stop-sheet-close" onClick={onClose}><X size={20} aria-hidden="true" /></Button>
        </div>
        <div className="overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm">
          {error ? <p className="rounded-md bg-red-50 p-3 text-red-800" role="alert">{error}</p> : null}
          {!d && !error ? <p className="text-slate-600">Loading...</p> : null}
          {d ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={d.status === 'done' ? 'green' : d.status === 'problem' ? 'red' : 'gray'} data-testid="stop-sheet-status">{STATUS_WORD[d.status] ?? d.status}</Badge>
                <span className="text-slate-600">Stop {d.seq} on {d.run.name}{d.run.pass > 1 ? ` (pass ${d.run.pass})` : ''}{d.run.crew ? `, ${d.run.crew}` : ''}</span>
              </div>
              {d.site.open_by ? <p className="mt-1 text-slate-600">Open by {d.site.open_by}</p> : null}

              {d.problems.length ? (
                <section className="mt-4">
                  <h3 className="font-semibold">Problems reported</h3>
                  <ul className="mt-1 space-y-1">
                    {d.problems.map((p) => (
                      <li key={p.id} className="rounded-md bg-red-50 p-2 text-red-900" data-testid="stop-sheet-problem">
                        <b>{p.kind}</b>{p.note ? `: ${p.note}` : ''}
                        <span className="block text-xs">{when(p.at, tz)}{p.resolved_at ? `, resolved ${when(p.resolved_at, tz)}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="mt-4">
                <h3 className="font-semibold">Visits</h3>
                {!d.visits.length ? <p className="mt-1 text-slate-600" data-testid="stop-sheet-no-visits">No visit logged yet.</p> : null}
                <ul className="mt-1 space-y-3">
                  {d.visits.map((v) => (
                    <li key={v.id} className="rounded-md border border-slate-200 p-3" data-testid="stop-sheet-visit">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium">{v.crew ?? 'Driver'}{v.replow ? ' (plowed again)' : ''}</span>
                        {v.voided ? <Badge tone="gray">Voided</Badge> : null}
                      </div>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        <dt className="text-slate-600">Arrived</dt><dd>{when(v.arrived_at, tz)}</dd>
                        <dt className="text-slate-600">Finished</dt><dd>{when(v.departed_at, tz) ?? 'Still on site'}</dd>
                        <dt className="text-slate-600">Services</dt><dd>{v.services.length ? v.services.join(', ') : 'None ticked'}</dd>
                        <dt className="text-slate-600">Depth</dt><dd>{v.depth_in !== null ? `${v.depth_in} in` : 'Not logged'}</dd>
                        {v.salt?.length ? <><dt className="text-slate-600">Salt</dt><dd>{v.salt.map((x) => `${x.qty} ${SALT_UNIT[x.unit] ?? x.unit}`).join(', ')}</dd></> : null}
                        <dt className="text-slate-600">GPS</dt>
                        <dd>{v.gps ? <>{v.gps.lat.toFixed(5)}, {v.gps.lon.toFixed(5)}{v.gps.accuracy_m !== null ? `, within ${feet(v.gps.accuracy_m)}` : ''}{v.gps.matched === false ? <span className="block text-xs font-medium text-amber-800">Not at the lot&apos;s mapped spot</span> : null}</> : 'Not shared'}</dd>
                        {v.notes ? <><dt className="text-slate-600">Note</dt><dd>{v.notes}</dd></> : null}
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mt-4">
                <h3 className="font-semibold">Photos</h3>
                {photos.length ? (
                  <ul className="mt-2 grid grid-cols-2 gap-2" data-testid="stop-sheet-photos">
                    {photos.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="block w-full overflow-hidden rounded-md border border-slate-200 text-left" onClick={() => setBig(p)} data-testid="stop-sheet-photo">
                          <img src={`/api/photos/${p.id}?thumb`} alt={`${PHASE[p.phase ?? ''] ?? 'Photo'} photo`} className="aspect-[4/3] w-full bg-slate-100 object-cover" loading="lazy" />
                          <span className="block px-2 py-1 text-xs"><b>{PHASE[p.phase ?? ''] ?? 'Photo'}</b> {when(p.taken_at ?? p.received_at, tz)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-slate-600" data-testid="stop-sheet-no-photos">No photos for this stop{d.visits.length ? '' : ' yet'}.</p>}
              </section>
            </>
          ) : null}
        </div>
      </div>
      {big ? <PhotoViewer photo={big} onClose={() => setBig(null)} /> : null}
    </div>
  );
}

function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useModal(box, { initial: close });
  return (
    <div ref={box} className="fixed inset-0 z-[80] flex flex-col bg-slate-950/95" role="dialog" aria-modal="true" aria-label="Photo" data-testid="photo-viewer" onClick={onClose}>
      <div className="flex justify-end p-3"><Button ref={close} variant="ghost" className="text-white hover:bg-slate-800" onClick={onClose}>Close</Button></div>
      <img src={`/api/photos/${photo.id}`} alt={`${PHASE[photo.phase ?? ''] ?? 'Photo'} photo, full size`} className="min-h-0 flex-1 object-contain" />
    </div>
  );
}
