'use client';

import { Button, Select, Textarea } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

type Answer = { status: 'acknowledged' | 'disputed'; note: string | null; disputed_line: string | null; responded_at: string } | null;

/** "Looks right", or dispute one line with a note. The office sees the answer beside the sub's statement. */
export function AnswerStatement({ token, from, to, answer, lines }: { token: string; from: string; to: string; answer: Answer; lines: string[] }) {
  const [state, setState] = useState<Answer>(answer);
  const [disputing, setDisputing] = useState(false);
  const [line, setLine] = useState(lines[0] ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = async (status: 'acknowledged' | 'disputed') => {
    setError(null);
    try {
      await api(`/api/sub/${token}/answer`, { body: { from, to, status, note: status === 'disputed' ? note : null, disputed_line: status === 'disputed' ? line : null } });
      setState({ status, note: status === 'disputed' ? note : null, disputed_line: status === 'disputed' ? line : null, responded_at: new Date().toISOString() });
      setDisputing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mt-3 border-t border-line-faint pt-3 text-sm" data-testid="sub-answer">
      {state ? <p className="mb-2" data-testid="sub-answer-state">{state.status === 'acknowledged' ? 'You said this statement looks right.' : `You disputed ${state.disputed_line ? `"${state.disputed_line}"` : 'a line'}: ${state.note ?? ''}`} You can change your answer.</p> : null}
      {disputing ? (
        <div className="space-y-2">
          {lines.length ? <label className="block">Which line<Select className="mt-1" value={line} onChange={(e) => setLine(e.target.value)} data-testid="sub-dispute-line">{lines.map((l) => <option key={l} value={l}>{l}</option>)}</Select></label> : null}
          <label className="block">What looks wrong<Textarea className="mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="We did two pushes at Lot 4, not one." data-testid="sub-dispute-note" /></label>
          <div className="flex gap-2"><Button size="sm" onClick={() => void send('disputed')} data-testid="sub-dispute-send">Send to the office</Button><Button size="sm" variant="ghost" onClick={() => setDisputing(false)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void send('acknowledged')} data-testid="sub-ack">Looks right</Button>
          <Button size="sm" variant="outline" onClick={() => setDisputing(true)} data-testid="sub-dispute">Something&apos;s wrong</Button>
        </div>
      )}
      {error ? <p className="mt-1 text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
