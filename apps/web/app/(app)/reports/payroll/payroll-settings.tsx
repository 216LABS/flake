'use client';

import { Button, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Owner: pay period length, workweek start, holidays and the ADP company code. */
export function PayrollSettings({ initial }: { initial: { period?: string; week_start?: number; anchor?: string; holidays?: string[]; adp_co_code?: string } }) {
  const router = useRouter();
  const [f, setF] = useState({ period: initial.period ?? 'weekly', week_start: String(initial.week_start ?? 0), anchor: initial.anchor ?? '', holidays: (initial.holidays ?? []).join(', '), adp: initial.adp_co_code ?? '' });
  const [msg, setMsg] = useState<string | null>(null);
  const holidays = f.holidays.split(/[\s,]+/).filter(Boolean);
  const bad = holidays.filter((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h));
  return (
    <details className="mt-6 max-w-2xl rounded-md border border-line-faint p-3 text-sm" data-testid="payroll-settings">
      <summary className="cursor-pointer font-semibold">Payroll settings</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="pp">Pay period</Label><Select id="pp" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option></Select></div>
        <div><Label htmlFor="ws">Workweek starts</Label><Select id="ws" value={f.week_start} onChange={(e) => setF({ ...f, week_start: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></div>
        {f.period === 'biweekly' ? <div><Label htmlFor="pa">A period started on</Label><Input id="pa" type="date" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value })} /></div> : null}
        <div><Label htmlFor="adp">ADP company code (optional)</Label><Input id="adp" maxLength={10} value={f.adp} onChange={(e) => setF({ ...f, adp: e.target.value })} data-testid="payroll-adp-code" /></div>
        <div className="sm:col-span-2"><Label htmlFor="hol">Holidays (dates, comma between)</Label><Input id="hol" placeholder="2027-01-01, 2027-01-18" value={f.holidays} onChange={(e) => setF({ ...f, holidays: e.target.value })} data-testid="payroll-holidays" /></div>
      </div>
      {bad.length ? <p className="mt-1 text-danger">Write dates like 2027-01-01: {bad.join(', ')}</p> : null}
      <Button size="sm" className="mt-2" disabled={bad.length > 0} data-testid="payroll-settings-save" onClick={async () => {
        setMsg(null);
        try {
          await api('/api/settings', { method: 'PATCH', body: { payroll: { period: f.period, week_start: Number(f.week_start), ...(f.anchor ? { anchor: f.anchor } : {}), holidays, adp_co_code: f.adp.trim() } } });
          setMsg('Saved.');
          router.refresh();
        } catch (e) {
          setMsg((e as Error).message);
        }
      }}>Save</Button>
      {msg ? <span className="ml-2" role="status">{msg}</span> : null}
    </details>
  );
}
