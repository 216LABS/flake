'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold">Set up your company</h1>
        <p className="mt-1 text-sm text-slate-600">Free through April 30, 2027. No card needed.</p>
        <Label className="mt-4" htmlFor="company">Company name</Label>
        <Input id="company" value={name} onChange={(e) => setName(e.target.value)} data-testid="company" />
        {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
        <Button variant="accent" className="mt-4 w-full" disabled={name.trim().length < 2} data-testid="create-company" onClick={async () => {
          try {
            await api('/api/onboarding', { body: { name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
            router.push('/dashboard');
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Continue</Button>
      </Card>
    </main>
  );
}
