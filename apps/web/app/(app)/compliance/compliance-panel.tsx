'use client';

import { CERT_KIND_LABEL } from '@flake/core/compliance';
import { Badge, Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { ButtonA } from '@/components/links';
import { api } from '@/lib/client';

interface Cert { id: string; crew_id: string | null; kind: string; insurer: string | null; policy_number: string | null; expires_on: string | null; is_default: boolean; file_name: string | null; state: string }
interface Claim { id: string; site_id: string; incident_at: string; reference: string | null; adjuster: string | null; status: string; notes: string | null; proof_packet_ids: string[]; label: string; customer: string; candidates: { id: string; created_at: string }[] }
interface Data { company: Cert[]; subs: { id: string; name: string; coverage: string; certs: Cert[] }[]; claims: Claim[] }

const STATE: Record<string, { word: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  ok: { word: 'Current', tone: 'green' }, no_end: { word: 'On file', tone: 'gray' }, expiring: { word: 'Ends soon', tone: 'amber' }, expired: { word: 'Ended', tone: 'red' },
  covered: { word: 'Covered', tone: 'green' }, missing: { word: 'No certificate', tone: 'red' },
};
const CLAIM: Record<string, string> = { open: 'Open', pending: 'Pending', closed: 'Closed', denied: 'Denied' };

export function CompliancePanel({ data, sites, tz, readOnly }: { data: Data; sites: { id: string; label: string; customer: string }[]; tz: string; readOnly: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ crew_id: string; kind: string; insurer: string; policy: string; effective: string; expires: string; isDefault: boolean } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [newClaim, setNewClaim] = useState({ site_id: sites[0]?.id ?? '', at: '', reference: '', adjuster: '', notes: '' });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const localInput = (iso: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const certLine = (c: Cert) => (
    <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="cert-row">
      <Badge tone={STATE[c.state]!.tone}>{STATE[c.state]!.word}</Badge>
      <span className="font-medium">{CERT_KIND_LABEL[c.kind] ?? c.kind}</span>
      <span className="text-muted wrap-anywhere">{[c.insurer, c.policy_number, c.expires_on ? `ends ${c.expires_on}` : null].filter(Boolean).join(', ')}</span>
      {c.is_default ? <Badge tone="gray">Sent to customers</Badge> : null}
      <ButtonA size="sm" href={`/api/certificates/${c.id}`} data-testid="cert-download">Download</ButtonA>
      {!readOnly && !c.crew_id && !c.is_default && c.kind !== 'w9' ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/certificates/${c.id}`, { method: 'PATCH' }))}>Make default</Button> : null}
      {!readOnly ? <Button size="sm" variant="ghost" disabled={busy} aria-label="Remove this certificate" onClick={async () => { if (await ask({ title: 'Remove this certificate?', body: 'The file is deleted too.', confirm: 'Remove', danger: true })) await run(() => api(`/api/certificates/${c.id}`, { method: 'DELETE' })); }}>Remove</Button> : null}
    </li>
  );
  const uploadForm = (crewId: string) => upload && upload.crew_id === crewId ? (
    <div className="mt-2 grid gap-2 rounded-md border border-line-faint p-2 sm:grid-cols-2" data-testid="cert-form">
      <div><Label htmlFor="ck">Kind</Label><Select id="ck" value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value })}>{Object.entries(CERT_KIND_LABEL).filter(([k]) => crewId || k !== 'w9').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      <div><Label htmlFor="ci">Insurer</Label><Input id="ci" maxLength={200} value={upload.insurer} onChange={(e) => setUpload({ ...upload, insurer: e.target.value })} data-testid="cert-insurer" /></div>
      <div><Label htmlFor="cp">Policy number</Label><Input id="cp" maxLength={100} value={upload.policy} onChange={(e) => setUpload({ ...upload, policy: e.target.value })} /></div>
      <div><Label htmlFor="ce">Ends{upload.kind === 'w9' ? ' (none for a W-9)' : ''}</Label><Input id="ce" type="date" value={upload.expires} onChange={(e) => setUpload({ ...upload, expires: e.target.value })} data-testid="cert-expires" /></div>
      <div className="sm:col-span-2"><Label htmlFor="cf">File (PDF or photo, up to 10 MB)</Label><Input id="cf" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="cert-file" /></div>
      {!crewId ? <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={upload.isDefault} onChange={(e) => setUpload({ ...upload, isDefault: e.target.checked })} /> The one to hand customers</label> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={busy || !file || (upload.kind !== 'w9' && !upload.expires)} data-testid="cert-save" onClick={async () => {
          const form = new FormData();
          if (crewId) form.set('crew_id', crewId);
          form.set('kind', upload.kind);
          for (const [k, v] of [['insurer', upload.insurer], ['policy_number', upload.policy], ['expires_on', upload.expires]] as const) if (v) form.set(k, v);
          if (!crewId) form.set('is_default', String(upload.isDefault));
          form.set('file', file!);
          const ok = await run(async () => {
            const res = await fetch('/api/certificates', { method: 'POST', body: form });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed');
          });
          if (ok) { setUpload(null); setFile(null); }
        }}>Save certificate</Button>
        <Button size="sm" variant="ghost" onClick={() => setUpload(null)}>Cancel</Button>
      </div>
    </div>
  ) : null;
  const startUpload = (crewId: string) => { setFile(null); setUpload({ crew_id: crewId, kind: 'general_liability', insurer: '', policy: '', effective: '', expires: '', isDefault: !crewId && !data.company.some((c) => c.is_default) }); };

  return (
    <div className="max-w-4xl space-y-4">
      {dialog}
      {error ? <p className="text-sm text-danger" role="alert" data-testid="compliance-error">{error}</p> : null}
      <Card data-testid="company-certs">
        <h2 className="font-semibold">Your certificates of insurance</h2>
        <p className="mt-1 text-sm text-muted">Download the default one to hand a customer who asks. We alert you on the dashboard 30 days before one ends.</p>
        {data.company.length ? <ul className="mt-2 divide-y divide-line-faint text-sm">{data.company.map(certLine)}</ul> : <p className="mt-2 text-sm text-muted">None yet.</p>}
        {!readOnly && !(upload && upload.crew_id === '') ? <Button className="mt-2" size="sm" variant="outline" data-testid="cert-add-company" onClick={() => startUpload('')}>Add a certificate</Button> : null}
        {uploadForm('')}
      </Card>

      <Card data-testid="sub-certs">
        <h2 className="font-semibold">Subcontractors</h2>
        <p className="mt-1 text-sm text-muted">Each sub needs a current certificate of insurance on file. Missing or ended cover is flagged, not blocked: you decide who plows.</p>
        {data.subs.length ? (
          <ul className="mt-2 space-y-3 text-sm">
            {data.subs.map((s) => (
              <li key={s.id} data-testid="sub-cover">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium wrap-anywhere">{s.name}</span><Badge tone={STATE[s.coverage]!.tone} data-testid="sub-coverage">{STATE[s.coverage]!.word}</Badge>
                  {!readOnly && !(upload && upload.crew_id === s.id) ? <Button size="sm" variant="ghost" data-testid="cert-add-sub" onClick={() => startUpload(s.id)}>Add certificate or W-9</Button> : null}</div>
                {s.certs.length ? <ul className="ml-2 divide-y divide-line-faint">{s.certs.map(certLine)}</ul> : null}
                {uploadForm(s.id)}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">No subcontractors on the crew.</p>}
      </Card>

      <Card data-testid="claims">
        <h2 className="font-semibold">Claims</h2>
        <p className="mt-1 text-sm text-muted">A slip and fall or damage claim on a lot, where it stands, and the incident packet that answers it.</p>
        {data.claims.length ? (
          <ul className="mt-2 space-y-3 text-sm">
            {data.claims.map((c) => (
              <li key={c.id} className="rounded-md border border-line-faint p-2" data-testid="claim-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium wrap-anywhere">{c.label}</span><span className="text-muted">{c.customer}, {when(c.incident_at)}</span>
                  {readOnly ? <Badge>{CLAIM[c.status]}</Badge> : <Select aria-label="Claim status" className="w-auto" value={c.status} disabled={busy} onChange={(e) => run(() => api(`/api/claims/${c.id}`, { method: 'PATCH', body: { status: e.target.value } }))} data-testid="claim-status">{Object.entries(CLAIM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
                </div>
                {c.reference || c.adjuster ? <p className="text-muted wrap-anywhere">{[c.reference ? `Ref ${c.reference}` : null, c.adjuster].filter(Boolean).join(', ')}</p> : null}
                {c.notes ? <p className="wrap-anywhere">{c.notes}</p> : null}
                <p className="mt-1">
                  {c.proof_packet_ids.length ? <span className="flex flex-wrap gap-2">{c.proof_packet_ids.map((p, i) => <ButtonA key={p} size="sm" href={`/api/proof/${p}?download=1`} data-testid="claim-packet">Packet {i + 1} (PDF)</ButtonA>)}</span> : null}
                  <ButtonA size="sm" href={`/proof?site=${c.site_id}&incident=${localInput(c.incident_at)}`} data-testid="claim-make-packet">Make an incident packet</ButtonA>
                  {!readOnly && c.candidates.filter((p) => !c.proof_packet_ids.includes(p.id)).length ? <Button size="sm" variant="ghost" disabled={busy} data-testid="claim-attach" onClick={() => run(() => api(`/api/claims/${c.id}`, { method: 'PATCH', body: { proof_packet_ids: [...new Set([...c.proof_packet_ids, ...c.candidates.map((p) => p.id)])] } }))}>Attach packets made for this time</Button> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">No claims.</p>}
        {!readOnly && sites.length ? (
          <div className="mt-3 grid gap-2 border-t border-line-faint pt-3 sm:grid-cols-2" data-testid="claim-form">
            <div><Label htmlFor="cl-site">Lot</Label><Select id="cl-site" value={newClaim.site_id} onChange={(e) => setNewClaim({ ...newClaim, site_id: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.customer})</option>)}</Select></div>
            <div><Label htmlFor="cl-at">When it happened</Label><Input id="cl-at" type="datetime-local" value={newClaim.at} onChange={(e) => setNewClaim({ ...newClaim, at: e.target.value })} data-testid="claim-at" /></div>
            <div><Label htmlFor="cl-ref">Claim number (optional)</Label><Input id="cl-ref" maxLength={100} value={newClaim.reference} onChange={(e) => setNewClaim({ ...newClaim, reference: e.target.value })} /></div>
            <div><Label htmlFor="cl-adj">Adjuster or contact (optional)</Label><Input id="cl-adj" maxLength={300} value={newClaim.adjuster} onChange={(e) => setNewClaim({ ...newClaim, adjuster: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="cl-notes">Notes (optional)</Label><Input id="cl-notes" maxLength={4000} value={newClaim.notes} onChange={(e) => setNewClaim({ ...newClaim, notes: e.target.value })} /></div>
            <Button size="sm" className="sm:col-span-2 sm:w-fit" disabled={busy || !newClaim.site_id || !newClaim.at} data-testid="claim-add" onClick={async () => {
              // The time typed is the company's local time.
              const local = newClaim.at;
              const guess = new Date(`${local}:00Z`);
              const shown = localInput(guess.toISOString());
              const offset = Date.parse(`${shown}:00Z`) - guess.getTime();
              const at = new Date(guess.getTime() - offset).toISOString();
              if (await run(() => api('/api/claims', { body: { site_id: newClaim.site_id, incident_at: at, ...(newClaim.reference ? { reference: newClaim.reference } : {}), ...(newClaim.adjuster ? { adjuster: newClaim.adjuster } : {}), ...(newClaim.notes ? { notes: newClaim.notes } : {}) } }))) setNewClaim({ ...newClaim, at: '', reference: '', adjuster: '', notes: '' });
            }}>Add claim</Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
