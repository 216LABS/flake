'use client';

import { t as translate, type DictKey, type Lang } from '@flake/core/i18n';
import { BigButton, bigButtonClass, cn } from '@flake/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { commit, flush, kvGet, kvSet, pending } from './outbox';

interface Stop {
  id: string;
  seq: number;
  status: string;
  site: { id: string; label: string; address: string; lat: number; lon: number; priority: number; open_by: string | null; notes: string | null };
  pins: { id: string; kind: string | null; note: string | null; has_photo: boolean }[];
  services: string[];
  salt_unit: string | null;
}
interface RunData {
  company: string;
  storm: { id: string; name: string; status: string };
  run: { id: string; pass: number };
  crew: { name: string; language: string } | null;
  has_reported_depth: boolean;
  stops: Stop[];
}
interface LocalVisit { visit: string; arrived_at: string; depth: number | null; services: string[]; salt: number; before: boolean; after: boolean }
interface LocalState {
  visits: Record<string, LocalVisit>;
  statuses: Record<string, string>;
  nextStopId: string | null;
  depthGiven: boolean;
  last: { stopId: string; visit: string; at: number } | null;
}
const EMPTY: LocalState = { visits: {}, statuses: {}, nextStopId: null, depthGiven: false, last: null };
const DEPTHS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12];
const UNDO_MS = 2 * 60 * 1000;
const POSITION_EVERY_MS = 60 * 1000;
const GEOFENCE_M = 75;
const NEAR_M = 800;
type Sync = 'saved' | 'sending' | 'synced';

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

function buzz() {
  if ('vibrate' in navigator) navigator.vibrate(40);
}

function navUrl(lat: number, lon: number) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return ios ? `https://maps.apple.com/?daddr=${lat},${lon}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function DriverApp({ token }: { token: string }) {
  const [run, setRun] = useState<RunData | null>(null);
  const [local, setLocal] = useState<LocalState>(EMPTY);
  const [lang, setLang] = useState<Lang>('en');
  // Only claim everything has landed once the phone has checked.
  const [sync, setSync] = useState<Sync>('saved');
  const [dead, setDead] = useState(false);
  const [uploadsRefused, setUploadsRefused] = useState(false);
  const [noCache, setNoCache] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showProblem, setShowProblem] = useState(false);
  const [here, setHere] = useState(false);
  const [tick, setTick] = useState(0);
  const localRef = useRef(local);
  const position = useRef<{ lat: number; lon: number; acc: number } | null>(null);
  const generation = useRef(0);
  const runRef = useRef<RunData | null>(null);
  const langRef = useRef<Lang>('en');
  const langChosen = useRef(false);
  const runKey = `run:${token}`;
  const localKey = `local:${token}`;

  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const saveLocal = useCallback((next: LocalState) => {
    localRef.current = next;
    setLocal(next);
    void kvSet(localKey, next);
  }, [localKey]);

  const flashToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const applyRun = useCallback(async (data: RunData) => {
    const prev = runRef.current;
    if (prev && prev.stops.map((s) => s.id).join() !== data.stops.map((s) => s.id).join()) flashToast(translate(langRef.current, 'moved'));
    runRef.current = data;
    setRun(data);
    // First open on this phone: use the language the office set for this driver, until they choose one.
    if (!langChosen.current && data.crew?.language === 'es') {
      langRef.current = 'es';
      setLang('es');
    }
    await kvSet(runKey, data);
    // Once nothing is queued, the server's view of each stop wins over the phone's.
    const before = generation.current;
    const p = await pending(token);
    // A tap during that read isn't in the count yet, and clearing now would undo it on screen.
    if (generation.current === before && p.actions === 0 && Object.keys(localRef.current.statuses).length) saveLocal({ ...localRef.current, statuses: {} });
  }, [runKey, token, saveLocal, flashToast]);

  const refresh = useCallback(async () => {
    const startedAt = generation.current;
    try {
      const res = await fetch(`/api/d/${token}/run`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.status === 410) return setDead(true);
      if (!res.ok) return;
      const data = (await res.json()) as RunData;
      if (generation.current === startedAt) await applyRun(data);
    } catch {
      // No signal: keep working from what is on the phone.
    }
  }, [token, applyRun]);

  const syncNow = useCallback(async () => {
    let result = await flush(token, () => setSync('sending'));
    // Another send is running. Wait for it rather than leave this tap's report until the next timer.
    for (let i = 0; result === 'idle' && i < 60; i++) {
      await new Promise((done) => setTimeout(done, 500));
      result = await flush(token, () => setSync('sending'));
    }
    generation.current++;
    if (result === 'dead') {
      setUploadsRefused(true);
      return setDead(true);
    }
    const p = await pending(token);
    const clear = p.actions === 0 && p.photos === 0;
    setSync(clear ? 'synced' : 'saved');
    if (clear && result === 'synced') await refresh();
  }, [token, refresh]);

  // Startup: load from the phone first so it opens instantly and with no signal.
  useEffect(() => {
    (async () => {
      const [cachedRun, cachedLocal, savedLang] = await Promise.all([kvGet<RunData>(runKey), kvGet<LocalState>(localKey), kvGet<Lang>('lang')]);
      if (cachedLocal) {
        localRef.current = cachedLocal;
        setLocal(cachedLocal);
      }
      if (cachedRun) {
        runRef.current = cachedRun;
        setRun(cachedRun);
      }
      if (savedLang) {
        langChosen.current = true;
        langRef.current = savedLang;
        setLang(savedLang);
      } else if (cachedRun?.crew?.language === 'es') {
        langRef.current = 'es';
        setLang('es');
      }
      const p = await pending(token);
      if (p.actions || p.photos) setSync('saved');
      await refresh();
      if (!cachedRun && !navigator.onLine) setNoCache(true);
      await syncNow();
      void navigator.storage?.persist?.();
    })();
  }, []);

  // Keep every pin photo on this route ready for when signal drops, not just the current stop's.
  const pinPhotos = (run?.stops ?? []).flatMap((s) => s.pins).filter((p) => p.has_photo).map((p) => p.id).join();
  useEffect(() => {
    if (!pinPhotos) return;
    const fetchAll = () => pinPhotos.split(',').forEach((id) => void fetch(`/api/d/${token}/pins/${id}`).catch(() => {}));
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(() => {
      if (navigator.serviceWorker.controller) fetchAll();
      else navigator.serviceWorker.addEventListener('controllerchange', fetchAll, { once: true });
    }).catch(() => {});
  }, [pinPhotos, token]);

  // Register the service worker and cache what this page already loaded, for reloads with no signal.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/d/' }).catch(() => {});
    navigator.serviceWorker.ready.then(async () => {
      const cache = await caches.open('flake-driver-v1');
      const assets = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/'));
      await Promise.all(assets.map((u) => cache.add(u).catch(() => {})));
      await cache.add(location.pathname).catch(() => {});
      document.documentElement.dataset.offlineReady = 'true';
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const sender = setInterval(() => void syncNow(), 15000);
    const poller = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 8000);
    const clock = setInterval(() => setTick((n) => n + 1), 10000);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(sender);
      clearInterval(poller);
      clearInterval(clock);
    };
  }, [syncNow, refresh]);

  const stops = useMemo(() => {
    const list = (run?.stops ?? []).map((s) => ({ ...s, status: local.statuses[s.id] ?? s.status }));
    return list.sort((a, b) => a.seq - b.seq);
  }, [run, local.statuses]);
  const doneCount = stops.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const onsite = stops.find((s) => s.status === 'onsite' && local.visits[s.id]);
  const remaining = stops.filter((s) => !['done', 'skipped'].includes(s.status) && !(s.status === 'onsite' && local.visits[s.id]));
  const next = onsite ?? remaining.find((s) => s.id === local.nextStopId) ?? remaining[0] ?? null;

  // Geofence: a foreground prompt only. It never records anything by itself. High accuracy only near the stop.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let watch: number | null = null;
    let high = false;
    let lastSent = 0;
    const start = (highAccuracy: boolean) => {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      high = highAccuracy;
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
          position.current = { lat, lon, acc };
          const stop = nextRef.current;
          const distance = stop ? metersBetween(lat, lon, stop.site.lat, stop.site.lon) : Infinity;
          setHere(distance <= GEOFENCE_M);
          if (distance <= NEAR_M !== high) start(distance <= NEAR_M);
          if (Date.now() - lastSent > POSITION_EVERY_MS && document.visibilityState === 'visible') {
            lastSent = Date.now();
            fetch(`/api/d/${token}/position`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon, acc, at: nowIso() }) }).catch(() => {});
          }
        },
        () => {},
        { enableHighAccuracy: highAccuracy, maximumAge: 15000, timeout: 20000 },
      );
    };
    start(false);
    return () => {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, [token]);

  // Taps run strictly in order. Each one commits to the phone before the screen changes.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inOrder = (fn: () => Promise<void>) => {
    chain.current = chain.current.then(fn).catch(() => flashToast(translate(langRef.current, 'save_failed')));
  };

  const apply = async (next: LocalState, actions: Record<string, unknown>[] = [], photo?: { blob: Blob; meta: Record<string, string> }) => {
    generation.current++;
    await commit({ token, localKey, local: next, actions, photo });
    generation.current++;
    localRef.current = next;
    setLocal(next);
    if (actions.length || photo) {
      setSync('saved');
      buzz();
      void syncNow();
    }
  };

  const action = (fields: Record<string, unknown>) => ({ client_uuid: uuid(), at: nowIso(), ...fields });
  const gps = () => (position.current ? { lat: position.current.lat, lon: position.current.lon, acc: position.current.acc } : null);

  const navigate = (stop: Stop) => {
    window.open(navUrl(stop.site.lat, stop.site.lon), '_blank', 'noopener');
    if (stop.status !== 'open') return;
    const queued = action({ kind: 'enroute', run_stop_id: stop.id });
    inOrder(() => apply({ ...localRef.current, statuses: { ...localRef.current.statuses, [stop.id]: 'enroute' } }, [queued]));
  };

  const arrive = (stop: Stop) => {
    const visit = uuid();
    const at = nowIso();
    const fix = gps();
    const queued = action({ at, kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: visit, gps: fix });
    inOrder(async () => {
      const open = localRef.current.visits[stop.id];
      if (open) {
        // A double tap records one arrival. Coming back after reporting a Problem resumes the same visit.
        if (localRef.current.statuses[stop.id] === 'onsite') return;
        await apply({ ...localRef.current, statuses: { ...localRef.current.statuses, [stop.id]: 'onsite' }, nextStopId: null }, [action({ at, kind: 'arrive', run_stop_id: stop.id, visit_client_uuid: open.visit, gps: fix })]);
        return;
      }
      await apply({
        ...localRef.current,
        visits: { ...localRef.current.visits, [stop.id]: { visit, arrived_at: at, depth: null, services: stop.services, salt: 0, before: false, after: false } },
        statuses: { ...localRef.current.statuses, [stop.id]: 'onsite' },
        nextStopId: null,
        last: { stopId: stop.id, visit, at: Date.now() },
      }, [queued]);
    });
  };

  const patchVisit = (stopId: string, patch: Partial<LocalVisit>) => {
    inOrder(async () => {
      const v = localRef.current.visits[stopId];
      if (v) await apply({ ...localRef.current, visits: { ...localRef.current.visits, [stopId]: { ...v, ...patch } } });
    });
  };

  const onPhoto = (stop: Stop, phase: 'before' | 'after', e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const takenAt = nowIso();
    inOrder(async () => {
      const v = localRef.current.visits[stop.id];
      if (!v) return;
      // Stored as the original bytes: no compression, so full resolution and EXIF reach the server.
      const meta = { client_uuid: uuid(), visit_client_uuid: v.visit, phase, taken_at: takenAt };
      await apply({ ...localRef.current, visits: { ...localRef.current.visits, [stop.id]: { ...v, ...(phase === 'before' ? { before: true } : { after: true }) } } }, [], { blob: file, meta });
      flashToast(t('photo_saved'));
    });
  };

  const chooseDepth = (stop: Stop, depth: number) => {
    const at = nowIso();
    const fix = gps();
    inOrder(async () => {
      const v = localRef.current.visits[stop.id];
      if (!v) return;
      await apply({ ...localRef.current, depthGiven: true, visits: { ...localRef.current.visits, [stop.id]: { ...v, depth } } }, [action({ at, kind: 'depth', run_stop_id: stop.id, visit_client_uuid: v.visit, depth_in: depth, gps: fix })]);
    });
  };

  const done = (stop: Stop) => {
    const at = nowIso();
    const fix = gps();
    inOrder(async () => {
      const v = localRef.current.visits[stop.id];
      if (!v) return; // A double tap on Done records one departure.
      const salt = v.salt > 0 && stop.salt_unit ? [{ unit: stop.salt_unit, qty: v.salt }] : null;
      const { [stop.id]: _finished, ...visits } = localRef.current.visits;
      await apply(
        { ...localRef.current, visits, statuses: { ...localRef.current.statuses, [stop.id]: 'done' }, last: { stopId: stop.id, visit: v.visit, at: Date.now() } },
        [action({ at, kind: 'done', run_stop_id: stop.id, visit_client_uuid: v.visit, services: v.services, depth_in: v.depth, salt, gps: fix, photos_coming: Number(v.before) + Number(v.after) })],
      );
    });
  };

  const undo = () => {
    const at = nowIso();
    inOrder(async () => {
      const last = localRef.current.last;
      if (!last) return;
      const { [last.stopId]: _gone, ...visits } = localRef.current.visits;
      await apply({ ...localRef.current, visits, statuses: { ...localRef.current.statuses, [last.stopId]: 'open' }, last: null }, [action({ at, kind: 'undo_last', run_stop_id: last.stopId, visit_client_uuid: last.visit })]);
      flashToast(t('undone'));
    });
  };

  const sendProblem = (stop: Stop, kind: string, voice: Blob | null) => {
    const client_uuid = uuid();
    const queued = action({ client_uuid, kind: 'problem', run_stop_id: stop.id, problem: kind, note: null });
    inOrder(async () => {
      await apply(
        { ...localRef.current, statuses: { ...localRef.current.statuses, [stop.id]: kind === 'skip' ? 'skipped' : 'problem' } },
        [queued],
        voice ? { blob: voice, meta: { client_uuid: uuid(), phase: 'voice', problem_client_uuid: client_uuid } } : undefined,
      );
      setShowProblem(false);
      flashToast(t('problem_sent'));
    });
  };

  const switchLang = () => {
    const nextLang: Lang = lang === 'en' ? 'es' : 'en';
    langChosen.current = true;
    langRef.current = nextLang;
    setLang(nextLang);
    void kvSet('lang', nextLang);
  };

  if (dead) {
    return (
      <Shell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center" data-testid="link-dead">
          <h1 className="text-3xl font-bold">{t('link_dead_title')}</h1>
          <p className="mt-4 text-xl text-slate-200" data-testid="link-dead-body">{sync !== 'synced' && !uploadsRefused ? t('link_dead_sending') : t('link_dead_body')}</p>
        </div>
      </Shell>
    );
  }
  if (!run) {
    return (
      <Shell>
        <div className="flex min-h-[70vh] items-center justify-center p-6 text-center text-xl" data-testid="loading">
          {noCache ? t('offline_loading') : '...'}
        </div>
      </Shell>
    );
  }

  const badge = { saved: t('saved'), sending: t('sending'), synced: t('synced') }[sync];
  const needDepth = !run.has_reported_depth && !local.depthGiven;
  const canUndo = local.last && Date.now() - local.last.at < UNDO_MS;
  void tick;

  return (
    <Shell>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-950 px-4 py-3">
        <div className="min-w-0">
          <div className="font-display truncate text-xl font-bold">{run.storm.name}</div>
          <div className="text-base text-slate-200" data-testid="progress">{t('of_done', { d: doneCount, n: stops.length })}</div>
        </div>
        <div className="flex items-center gap-2">
          <span data-testid="sync-badge" data-state={sync} className={cn('rounded-full px-3 py-2 text-sm font-bold', sync === 'synced' ? 'bg-emerald-400 text-black' : sync === 'sending' ? 'bg-sky-300 text-black' : 'bg-amber-300 text-black')}>{badge}</span>
          <BigButton onClick={switchLang} data-testid="lang" className="text-sm">{t('language')}</BigButton>
        </div>
      </header>

      {toast ? <div role="status" className="mx-4 mb-2 rounded-lg bg-sky-300 p-3 text-center text-lg font-bold text-black">{toast}</div> : null}

      {here && next && next.status !== 'onsite' ? (
        <button type="button" onClick={() => arrive(next)} className={cn(bigButtonClass('go', 'tall'), 'mx-4 mb-3 w-[calc(100%-2rem)]')} data-testid="geofence-banner">{t('here_arrive')}</button>
      ) : null}

      <main className="space-y-4 px-4 pb-8">
        {!next ? (
          <div className="rounded-lg bg-slate-800 p-8 text-center text-2xl font-bold" data-testid="all-done">{t('all_done')}</div>
        ) : next.status === 'onsite' && local.visits[next.id] ? (
          showProblem ? (
            <ProblemPanel t={t} onCancel={() => setShowProblem(false)} onSend={(k, v) => sendProblem(next, k, v)} />
          ) : (
            <OnSite
              t={t}
              stop={next}
              visit={local.visits[next.id]!}
              needDepth={needDepth}
              onPhoto={(p, e) => onPhoto(next, p, e)}
              onDepth={(d) => chooseDepth(next, d)}
              onServices={(services) => patchVisit(next.id, { services })}
              onSalt={(salt) => patchVisit(next.id, { salt })}
              onDone={() => done(next)}
              onProblem={() => setShowProblem(true)}
            />
          )
        ) : showProblem ? (
          <ProblemPanel t={t} onCancel={() => setShowProblem(false)} onSend={(k, v) => sendProblem(next, k, v)} />
        ) : (
          <NextStop t={t} token={token} stop={next} onNavigate={() => navigate(next)} onArrive={() => arrive(next)} onProblem={() => setShowProblem(true)} />
        )}

        {canUndo ? <BigButton className="w-full" onClick={undo} data-testid="undo">{t('undo_last')}</BigButton> : null}

        {next && next.status !== 'onsite' && remaining.length > 1 ? (
          <section>
            <h2 className="mb-2 text-lg font-bold">{t('remaining')}</h2>
            <ul className="space-y-2">
              {remaining.filter((s) => s.id !== next.id).map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => saveLocal({ ...localRef.current, nextStopId: s.id })} className="min-h-[64px] w-full rounded-xl bg-slate-800 p-3 text-left text-lg" data-testid="other-stop">
                    <div className="font-bold">{s.site.label}</div>
                    <div className="text-base text-slate-200">{s.site.address}</div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </Shell>
  );
}

const Shell = ({ children }: { children: React.ReactNode }) => <div className="min-h-dvh bg-slate-950 text-white">{children}</div>;

type T = (key: DictKey, vars?: Record<string, string | number>) => string;

function NextStop({ t, token, stop, onNavigate, onArrive, onProblem }: { t: T; token: string; stop: Stop; onNavigate: () => void; onArrive: () => void; onProblem: () => void }) {
  return (
    <section className="rounded-lg bg-slate-800 p-4" data-testid="next-stop">
      <div className="font-display text-base font-bold uppercase tracking-wider text-beacon">{t('next_stop')}</div>
      <h1 className="mt-1 text-3xl font-bold" data-testid="stop-label">{stop.site.label}</h1>
      <p className="mt-1 text-xl text-slate-100">{stop.site.address}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-base">
        <span className="rounded-lg bg-slate-700 px-3 py-2">{t('priority')} {stop.site.priority}</span>
        {stop.site.open_by ? <span className="rounded-lg bg-slate-700 px-3 py-2">{t('window')} {stop.site.open_by}</span> : null}
        {stop.pins.map((p) => <span key={p.id} className="rounded-lg bg-slate-700 px-3 py-2">{p.kind}{p.note ? `: ${p.note}` : ''}</span>)}
      </div>
      {stop.site.notes ? <p className="mt-3 text-lg text-slate-100"><b>{t('notes')}:</b> {stop.site.notes}</p> : null}
      {stop.pins.some((p) => p.has_photo) ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {stop.pins.filter((p) => p.has_photo).map((p) => (
            <img key={p.id} src={`/api/d/${token}/pins/${p.id}`} alt={[p.kind, p.note].filter(Boolean).join(': ')} className="w-full rounded-lg" data-testid={`driver-pin-${p.id}`} />
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3">
        <BigButton onClick={onNavigate} data-testid="navigate">{t('navigate')}</BigButton>
        <BigButton tone="go" height="tall" onClick={onArrive} data-testid="arrive">{t('arrive')}</BigButton>
        <BigButton tone="warn" onClick={onProblem} data-testid="problem">{t('problem')}</BigButton>
      </div>
    </section>
  );
}

function PhotoButton({ label, done, testId, onChange }: { label: string; done: boolean; testId: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className={cn(bigButtonClass(done ? 'on' : 'plain', 'tall'), 'w-full cursor-pointer')}>
      {done ? `✓ ${label}` : label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid={testId} onChange={onChange} />
    </label>
  );
}

function OnSite(p: { t: T; stop: Stop; visit: LocalVisit; needDepth: boolean; onPhoto: (phase: 'before' | 'after', e: ChangeEvent<HTMLInputElement>) => void; onDepth: (d: number) => void; onServices: (s: string[]) => void; onSalt: (n: number) => void; onDone: () => void; onProblem: () => void }) {
  const { t, stop, visit } = p;
  const blocked = p.needDepth && visit.depth === null;
  return (
    <section className="space-y-4 rounded-lg bg-slate-800 p-4" data-testid="onsite">
      <h1 className="font-display text-3xl font-bold leading-tight">{stop.site.label}</h1>
      <PhotoButton label={t('before_photo')} done={visit.before} testId="before-photo" onChange={(e) => p.onPhoto('before', e)} />
      <div>
        <h2 className="mb-2 text-lg font-bold">{p.needDepth ? t('depth_required') : t('depth')}</h2>
        <div className="grid grid-cols-5 gap-2">
          {DEPTHS.map((d) => (
            <BigButton key={d} tone={visit.depth === d ? 'on' : 'plain'} className="px-1" onClick={() => p.onDepth(d)} data-testid={`depth-${d}`}>{d === 12 ? '12+' : d}&quot;</BigButton>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-lg font-bold">{t('services')}</h2>
        <div className="flex flex-wrap gap-2">
          {stop.services.map((s) => {
            const on = visit.services.includes(s);
            return <BigButton key={s} tone={on ? 'on' : 'plain'} onClick={() => p.onServices(on ? visit.services.filter((x) => x !== s) : [...visit.services, s])} data-testid={`service-${s}`}>{({ plow: t('service_plow'), salt: t('service_salt'), walks: t('service_walks'), haul: t('service_haul') } as Record<string, string>)[s] ?? s}</BigButton>;
          })}
        </div>
      </div>
      {stop.salt_unit ? (
        <div>
          <h2 className="mb-2 text-lg font-bold">{t('salt')} ({stop.salt_unit})</h2>
          <div className="flex items-center gap-3">
            <BigButton className="flex-1 text-3xl" onClick={() => p.onSalt(Math.max(0, visit.salt - 1))} data-testid="salt-minus">-</BigButton>
            <span className="w-16 text-center text-4xl font-bold" data-testid="salt-qty">{visit.salt}</span>
            <BigButton className="flex-1 text-3xl" onClick={() => p.onSalt(visit.salt + 1)} data-testid="salt-plus">+</BigButton>
          </div>
        </div>
      ) : null}
      <PhotoButton label={t('after_photo')} done={visit.after} testId="after-photo" onChange={(e) => p.onPhoto('after', e)} />
      {!visit.after ? <p className="text-center text-base font-medium text-amber-300" data-testid="no-photo-hint">{t('no_after_photo')}</p> : null}
      <BigButton tone="done" height="tall" className="w-full" disabled={blocked} onClick={p.onDone} data-testid="done">{t('done')}</BigButton>
      <BigButton tone="warn" className="w-full" onClick={p.onProblem} data-testid="problem">{t('problem')}</BigButton>
    </section>
  );
}

function ProblemPanel({ t, onCancel, onSend }: { t: T; onCancel: () => void; onSend: (kind: string, voice: Blob | null) => void }) {
  const [voice, setVoice] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const toggle = async () => {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        setVoice(new Blob(chunks, { type: r.mimeType }));
        stream.getTracks().forEach((track) => track.stop());
      };
      r.start();
      recorder.current = r;
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg bg-slate-800 p-4" data-testid="problem-panel">
      <h1 className="text-2xl font-bold">{t('problem')}</h1>
      {canRecord ? <BigButton tone={recording ? 'warn' : voice ? 'on' : 'plain'} className="w-full" onClick={() => void toggle()}>{recording ? t('stop_recording') : voice ? `✓ ${t('voice_note')}` : t('voice_note')}</BigButton> : null}
      {(['blocked', 'breakdown', 'skip', 'damage'] as const).map((k) => (
        <BigButton key={k} tone="warn" height="tall" className="w-full" onClick={() => onSend(k, voice)} data-testid={`problem-${k}`}>{t(k)}</BigButton>
      ))}
      <BigButton className="w-full" onClick={onCancel}>{t('back')}</BigButton>
    </section>
  );
}

