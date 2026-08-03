import { describe, it, expect } from 'vitest';
import { sortSomedayItems } from '@aoi/shared';
import type { SomedayItem } from '@aoi/shared';

function makeItem(overrides: Partial<SomedayItem> = {}): SomedayItem {
  return {
    id: `someday_${Math.floor(Math.random() * 1000000)}`,
    title: 'Item',
    category: 'other',
    createdByRole: 'you',
    createdAt: '2026-07-01T10:00:00.000Z',
    checkedAt: null,
    checkedByRole: null,
    ...overrides,
  };
}

// The app consumes the shared ordering directly (single source of truth with
// the API), so this is a thin contract test over the canonical order.
describe('sortSomedayItems (canonical order shared with the API)', () => {
  it('puts open items first (newest first), then checked items (most recently checked first)', () => {
    const items = [
      makeItem({ id: 'old-open', createdAt: '2026-06-01T10:00:00.000Z' }),
      makeItem({
        id: 'checked-long-ago',
        createdAt: '2026-06-02T10:00:00.000Z',
        checkedAt: '2026-07-02T10:00:00.000Z',
        checkedByRole: 'you',
      }),
      makeItem({ id: 'new-open', createdAt: '2026-07-10T10:00:00.000Z' }),
      makeItem({
        id: 'checked-recently',
        createdAt: '2026-06-15T10:00:00.000Z',
        checkedAt: '2026-07-20T10:00:00.000Z',
        checkedByRole: 'partner',
      }),
    ];

    const sorted = sortSomedayItems(items);
    expect(sorted.map((item) => item.id)).toEqual([
      'new-open',
      'old-open',
      'checked-recently',
      'checked-long-ago',
    ]);
  });

  it('does not mutate its input', () => {
    const items = [
      makeItem({ id: 'b', createdAt: '2026-06-01T10:00:00.000Z' }),
      makeItem({ id: 'a', createdAt: '2026-07-01T10:00:00.000Z' }),
    ];

    const sorted = sortSomedayItems(items);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('returns an empty array for an empty list', () => {
    expect(sortSomedayItems([])).toEqual([]);
  });
});
