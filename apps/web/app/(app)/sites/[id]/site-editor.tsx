'use client';

import { Badge, Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { useConfirm } from '@/components/confirm';
import { uploadPinPhoto } from '@/lib/shrink-image';
import { MapView, type MapMode, type TileLayers } from '@/components/map-view';

export function SiteEditor({ site, pins, layers }: { site: any; pins: any[]; layers: TileLayers }) {
  const router = useRouter();
  const [polygon, setPolygon] = useState(site.polygons);
  const [sqft, setSqft] = useState<number | null>(site.area_confirmed_sqft ?? site.area_estimate_sqft);
  const [mode, setMode] = useState<MapMode>('view');
  const [notes, setNotes] = useState(site.notes ?? '');
  const [priority, setPriority] = useState(site.priority);
  const [openBy, setOpenBy] = useState(site.service_window?.open_by ?? '');
  const [notBefore, setNotBefore] = useState(site.service_window?.not_before ?? '');
  const [pinKind, setPinKind] = useState('stake');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  // Checked here first, so a bad value says what's wrong instead of the page quietly going back to the old one.
  const problem = sqft !== null && (!Number.isFinite(sqft) || sqft < 0) ? 'The area can\'t be negative.'
    : sqft !== null && sqft > 50_000_000 ? 'The area must be 50,000,000 sq ft or less.'
    : !/^[1-5]$/.test(String(priority)) ? 'Priority must be a whole number from 1 to 5.'
    : notes.length > 4000 ? 'Notes must be 4,000 characters or fewer.'
    : null;
  const save = async () => {
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/sites/${site.id}`, { method: 'PATCH', body: { polygons: polygon, area_confirmed_sqft: sqft, notes, priority: Number(priority), service_window: openBy || notBefore || site.service_window?.days?.length ? { ...(site.service_window?.days?.length ? { days: site.service_window.days } : {}), ...(openBy ? { open_by: openBy } : {}), ...(notBefore ? { not_before: notBefore } : {}) } : null } });
      setMsg({ ok: true, text: 'Saved' });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const addPin = async (lat: number, lon: number) => {
    await api('/api/pins', { body: { site_id: site.id, kind: pinKind, lat, lon } });
    router.refresh();
  };
  return (
    <Card>
      {dialog}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={mode === 'edit' ? 'accent' : 'outline'} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>Draw / edit area</Button>
        <Button size="sm" variant={mode === 'pin' ? 'accent' : 'outline'} onClick={() => setMode(mode === 'pin' ? 'view' : 'pin')}>Drop pin</Button>
        {mode === 'pin' ? <Select aria-label="Pin type" className="h-8 w-32 py-0" value={pinKind} onChange={(e) => setPinKind(e.target.value)}>{['stake', 'pile', 'ada', 'entrance', 'hazard', 'other'].map((k) => <option key={k}>{k}</option>)}</Select> : null}
      </div>
      <MapView layers={layers} base="satellite" center={{ lat: site.lat, lon: site.lon }} zoom={18} polygon={polygon} mode={mode} pins={pins.filter((p) => p.lat !== null).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.kind }))} onPolygon={(p, a) => { setPolygon(p); setSqft(a); }} onPin={(lat, lon) => void addPin(lat, lon)} />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="sqft">Confirmed area (sq ft)</Label><Input id="sqft" type="number" min={0} max={50000000} value={sqft ?? ''} onChange={(e) => { setMsg(null); setSqft(e.target.value ? Number(e.target.value) : null); }} /></div>
        <div><Label htmlFor="prio">Priority (1 is first)</Label><Input id="prio" type="number" min={1} max={5} step={1} value={priority} onChange={(e) => { setMsg(null); setPriority(e.target.value); }} /></div>
        <div><Label htmlFor="open">Open by</Label><Input id="open" type="time" value={openBy} onChange={(e) => setOpenBy(e.target.value)} /></div>
        <div><Label htmlFor="notbefore">Not before (optional)</Label><Input id="notbefore" type="time" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} data-testid="not-before" /><p className="mt-1 text-xs text-slate-600">Suggest order won&apos;t plan this lot earlier. For a lot in use until a set time.</p></div>
        <div className="sm:col-span-3"><Label htmlFor="n">Notes for the driver</Label><Input id="n" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} data-testid="site-save" onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</Button>
        {msg ? <span className={msg.ok ? 'text-sm font-medium text-emerald-800' : 'text-sm text-red-700'} role={msg.ok ? 'status' : 'alert'} data-testid="site-msg">{msg.text}</span> : null}
      </div>
      {pins.length ? (
        <ul className="mt-3 space-y-2">
          {pins.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="pin-row">
              <Badge>{p.kind}</Badge>
              <span>{p.note}</span>
              {p.photo_path ? <img src={`/api/pins/${p.id}/photo?v=${encodeURIComponent(p.photo_path)}`} alt={p.note ?? p.kind} width={64} height={64} className="h-16 w-16 rounded-sm object-cover" data-testid={`pin-thumb-${p.id}`} /> : null}
              <label className="cursor-pointer text-sky-800 underline">
                {p.photo_path ? 'Replace photo' : 'Add photo'}
                <input type="file" accept="image/*" className="sr-only" data-testid={`pin-photo-${p.id}`} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    await uploadPinPhoto(p.id, file);
                    router.refresh();
                  } catch (err) {
                    setMsg({ ok: false, text: (err as Error).message });
                  }
                }} />
              </label>
              <Button size="sm" variant="ghost" className="px-2" data-testid={`pin-remove-${p.id}`} onClick={async () => {
                // Drivers see every pin on their route, so a misplaced one has to be removable.
                if (!(await ask({ title: `Remove this ${p.kind} pin?`, body: 'Drivers stop seeing it.', confirm: 'Remove pin', danger: true }))) return;
                try {
                  await api(`/api/pins/${p.id}`, { method: 'DELETE' });
                  router.refresh();
                } catch (err) {
                  setMsg({ ok: false, text: (err as Error).message });
                }
              }}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
