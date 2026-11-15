'use client';

import { Badge, Button, Card, Label, Select, Textarea } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { shrinkImage } from '@/lib/shrink-image';

export interface WalkItem { id: string; season: string; kind: string; note: string | null; has_photo: boolean; taken_at: string | null }

const KIND: Record<string, string> = { damage: 'Damage already there', pile: 'Where piles go', hazard: 'Hazard', drain: 'Drain or grate', note: 'Note' };

/**
 * The pre-season site walk: what the lot looks like before the first snow, so a spring "your plow did this" has an
 * answer. Each item is a photo, a note, or both, kept by season and printed in proof packets.
 */
export function SiteWalk({ siteId, items, season, canEdit, tz }: { siteId: string; items: WalkItem[]; season: string; canEdit: boolean; tz: string }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const seasons = [...new Set([season, ...items.map((i) => i.season)])].sort().reverse();
  const [shown, setShown] = useState(season);
  const [kind, setKind] = useState('damage');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = items.filter((i) => i.season === shown);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('season', shown);
      form.set('kind', kind);
      if (note.trim()) form.set('note', note.trim());
      if (file) {
        form.set('file', await shrinkImage(file, 2400, 0.88), 'walk.jpg');
        form.set('taken_at', new Date(file.lastModified || Date.now()).toISOString());
      }
      const res = await fetch(`/api/sites/${siteId}/walk`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'That did not save.');
      setNote('');
      setFile(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="site-walk">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Site walk</h2>
        {seasons.length > 1 ? <Select aria-label="Season" className="h-8 w-auto py-0 text-sm" value={shown} onChange={(e) => setShown(e.target.value)}>{seasons.map((s) => <option key={s} value={s}>{s}</option>)}</Select> : <span className="text-sm text-muted">{shown}</span>}
      </div>
      <p className="mt-1 text-sm text-muted">Before the first snow: photos of damage already there, where the piles go, and hazards. Proof packets include them.</p>
      {list.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="walk-items">
          {list.map((i) => (
            <li key={i.id} className="rounded-md border border-line-faint p-2 text-sm" data-testid="walk-item">
              {i.has_photo ? <a href={`/api/sites/${siteId}/walk/${i.id}/photo`} target="_blank" rel="noopener"><img src={`/api/sites/${siteId}/walk/${i.id}/photo`} alt={[KIND[i.kind], i.note].filter(Boolean).join(': ')} className="mb-1 h-24 w-full rounded object-cover" loading="lazy" /></a> : null}
              <Badge>{KIND[i.kind] ?? i.kind}</Badge>
              {i.note ? <p className="mt-1 wrap-anywhere">{i.note}</p> : null}
              {i.taken_at ? <p className="text-xs text-muted">{new Date(i.taken_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })}</p> : null}
              {canEdit ? <Button size="sm" variant="ghost" className="-ml-2 mt-1" disabled={busy} onClick={async () => {
                if (!(await ask({ title: 'Remove this item?', body: 'Its photo is deleted too. Use this for something added by mistake.', confirm: 'Remove', danger: true }))) return;
                const res = await fetch(`/api/sites/${siteId}/walk/${i.id}`, { method: 'DELETE' });
                if (res.ok) router.refresh(); else setError('That did not remove.');
              }}>Remove</Button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-ink-2" data-testid="walk-empty">Nothing recorded for {shown} yet.</p>}
      {canEdit ? (
        <div className="mt-3 space-y-2 border-t border-line-faint pt-3" data-write>
          <div><Label htmlFor="walk-kind">What</Label><Select id="walk-kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="walk-kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label htmlFor="walk-note">Note</Label><Textarea id="walk-note" rows={2} maxLength={1000} placeholder="Cracked curb by the dumpster" value={note} onChange={(e) => setNote(e.target.value)} data-testid="walk-note" /></div>
          <label className="block text-sm"><span className="font-medium">Photo</span><input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="walk-photo" /></label>
          <Button disabled={busy || (!note.trim() && !file)} onClick={() => void add()} data-testid="walk-add">{busy ? 'Saving' : 'Add to site walk'}</Button>
          {error ? <p className="text-sm text-danger" role="alert" data-testid="walk-error">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
