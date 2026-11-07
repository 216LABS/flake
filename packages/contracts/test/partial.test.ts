import { describe, expect, it } from 'vitest';
import { crewUpdate, customerUpdate, routeUpdate, siteUpdate } from '../src/index';

/** A PATCH must change only what it names. A default leaking through .partial() would silently reset a field. */
describe('update schemas apply no defaults', () => {
  it('customer keeps its billing mode', () => expect(customerUpdate.parse({ name: 'x' })).not.toHaveProperty('billing_mode'));
  it('site keeps its priority', () => expect(siteUpdate.parse({ notes: 'x' })).not.toHaveProperty('priority'));
  it('crew keeps its language', () => expect(crewUpdate.parse({ active: false })).not.toHaveProperty('language'));
  it('route keeps its stops', () => expect(routeUpdate.parse({ name: 'x' })).not.toHaveProperty('site_ids'));
});
