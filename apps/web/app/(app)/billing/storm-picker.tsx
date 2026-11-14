'use client';

import { Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';

const GROUPS = [['closed', 'Ready to bill'], ['active', 'Live'], ['billed', 'Billed']] as const;

/**
 * Every storm stays reachable: a claim or a late invoice can be about one from last season. Storms still to bill come
 * first, so a long season's list doesn't bury them (issue 124).
 */
export function StormPicker({ storms, selected }: { storms: { id: string; name: string; status: string }[]; selected: string }) {
  const router = useRouter();
  return (
    <div className="mb-4 max-w-md">
      <Label htmlFor="storm-picker">Storm</Label>
      <Select id="storm-picker" data-testid="storm-picker" value={selected} onChange={(e) => router.push(`/billing?storm=${e.target.value}`)}>
        {GROUPS.map(([status, label]) => {
          const list = storms.filter((s) => (s.status === status) || (status === 'billed' && !GROUPS.some(([k]) => k === s.status)));
          return list.length ? <optgroup key={status} label={label}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null;
        })}
      </Select>
    </div>
  );
}
