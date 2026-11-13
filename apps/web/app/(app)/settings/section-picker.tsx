'use client';

import { Select } from '@flake/ui';
import { useRouter } from 'next/navigation';

/**
 * On a phone, Settings is one line: the section you're in, opening the phone's own list of every section. Ten tabs
 * wrapped onto three rows and pushed the settings themselves half a screen down.
 */
export function SectionPicker({ sections, current }: { sections: readonly (readonly [string, string])[]; current: string }) {
  const router = useRouter();
  return (
    <div className="mb-5 md:hidden">
      <label htmlFor="settings-section" className="sr-only">Settings section</label>
      <Select id="settings-section" data-testid="settings-section" className="font-semibold" value={current} onChange={(e) => router.push(`/settings?tab=${e.target.value}`)}>
        {sections.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </Select>
    </div>
  );
}
