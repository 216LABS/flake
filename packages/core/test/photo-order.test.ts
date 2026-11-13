import { describe, expect, it } from 'vitest';
import { photoOrder } from '../src/proof';

describe('photoOrder', () => {
  it('puts before ahead of after, issue photos last, then by time taken', () => {
    const photos = [
      { id: 'c', phase: 'issue', taken_device_at: '2026-11-12T10:00:00Z' },
      { id: 'b', phase: 'after', taken_device_at: '2026-11-12T10:05:00Z' },
      { id: 'a2', phase: 'before', taken_device_at: '2026-11-12T10:01:00Z' },
      { id: 'a1', phase: 'before', taken_device_at: new Date('2026-11-12T10:00:00Z') },
      { id: 'z', phase: null, taken_device_at: null },
    ];
    expect([...photos].sort(photoOrder).map((p) => p.id)).toEqual(['a1', 'a2', 'b', 'c', 'z']);
  });
  it('keeps a stable order when phase and time match or time is missing', () => {
    const photos = [{ id: 'y', phase: 'after', taken_device_at: null }, { id: 'x', phase: 'after', taken_device_at: null }, { id: 'w', phase: 'after' }];
    expect([...photos].sort(photoOrder).map((p) => p.id)).toEqual(['w', 'x', 'y']);
  });
});
