'use client';

import { Button, Card, Label, Select } from '@flake/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';

export function WeatherClock({ fixtures, fixture, clock }: { fixtures: string[]; fixture: string; clock: string }) {
  const [name, setName] = useState(fixture);
  const [now, setNow] = useState(clock);
  const [out, setOut] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const post = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await api('/api/dev/weather', { body });
      setNow(r.clock);
      setOut(r);
      if (body.poll) setPolls((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="max-w-2xl">
      <Label htmlFor="fx">Fixture</Label>
      <div className="flex gap-2">
        <Select id="fx" value={name} onChange={(e) => setName(e.target.value)} data-testid="fixture">{fixtures.map((f) => <option key={f}>{f}</option>)}</Select>
        <Button variant="outline" data-testid="load-fixture" onClick={() => void post({ fixture: name })}>Load</Button>
      </div>
      <p className="mt-3 text-sm">Fake clock: <b data-testid="clock">{now}</b></p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[1, 6, 12].map((h) => <Button key={h} variant="outline" data-testid={`advance-${h}`} onClick={() => void post({ advanceHours: h })}>+{h} h</Button>)}
        <Button variant="accent" data-testid="poll" onClick={() => void post({ poll: true })}>Run poll now</Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {polls ? <p className="mt-3 text-sm" data-testid="polled">Polls run: {polls}</p> : null}
      {out?.header ? <p className="mt-3 text-sm" data-testid="wx">Next 12 h: {String(out.header.forecast_in)}&quot;. Elapsed: {String(out.header.elapsed_in)}&quot;. Source: {out.header.source}.</p> : null}
      {out?.created?.length ? (
        <ul className="mt-2 text-sm" data-testid="created-alerts">{out.created.map((id: string) => <li key={id}><Link className="text-sky-800 underline" href={`/alerts/${id}`}>Alert created: review</Link></li>)}</ul>
      ) : null}
    </Card>
  );
}
