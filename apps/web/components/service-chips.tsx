import { Badge } from '@flake/ui';

type Svc = { service: string; trigger_in?: number | null };
const WORD: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };

/**
 * What a driver can tick at this lot, from the signed contract in force (issue 192). Without one, the driver sees Plow
 * only and nothing is billed, which is why salt "sometimes" showed up for a tester.
 */
export function ServiceChips({ services, compact = false }: { services: Svc[] | null; compact?: boolean }) {
  if (!services) return <Badge tone="amber" data-testid="no-contract-chip">{compact ? 'No contract: plow only' : 'No signed contract: plow only, not billed'}</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="service-chips">
      {services.map((s) => (
        <Badge key={s.service} tone={s.service === 'salt' ? 'blue' : 'gray'} data-testid={`chip-${s.service}`}>
          {WORD[s.service] ?? s.service}{(s.service === 'plow' || s.service === 'walks') && s.trigger_in != null ? ` (${s.trigger_in}" trigger)` : ''}
        </Badge>
      ))}
    </span>
  );
}

export const SERVICES_FROM = 'Services come from the signed contract. To change them, make a new quote for this lot.';
