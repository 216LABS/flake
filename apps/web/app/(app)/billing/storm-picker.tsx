'use client';

import { Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';

/** Every storm stays reachable: a claim or a late invoice can be about one from last season. */
export function StormPicker({ storms, selected }: { storms: { id: string; name: string }[]; selected: string }) {
  const router = useRouter();
  return (
    <div className="mb-4 max-w-md">
      <Label htmlFor="storm-picker">Storm</Label>
      <Select id="storm-picker" data-testid="storm-picker" value={selected} onChange={(e) => router.push(`/billing?storm=${e.target.value}`)}>
        {storms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </div>
  );
}
