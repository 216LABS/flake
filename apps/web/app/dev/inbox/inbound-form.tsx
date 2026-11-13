'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function InboundForm() {
  const router = useRouter();
  const [from, setFrom] = useState('+12165550101');
  const [result, setResult] = useState<string | null>(null);
  const send = async (body: string) => {
    try {
      const r = await api('/api/dev/sms', { body: { from, body } });
      setResult(`${body}: handled as ${r.kind}${r.reply ? `. Reply: ${r.reply}` : ''}`);
      router.refresh();
    } catch (e) {
      setResult((e as Error).message);
    }
  };
  return (
    <Card className="mb-4">
      <Label htmlFor="from">Simulate an inbound text from</Label>
      <div className="flex flex-wrap gap-2">
        <Input id="from" className="w-48" value={from} onChange={(e) => setFrom(e.target.value)} />
        {['STOP', 'START', 'HELP', 'YES', 'NO'].map((w) => <Button key={w} variant="outline" onClick={() => void send(w)}>{w}</Button>)}
      </div>
      {result ? <p className="mt-2 text-sm text-muted">{result}</p> : null}
    </Card>
  );
}
