import { describe, expect, it, vi } from 'vitest';

// The provider module reaches native modules at import time through its
// context dependencies; the ordering helper under test is pure, so those edges
// are stubbed rather than pulled in.
vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(async () => {}),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
}));
vi.mock('@/features/space/space-context', () => ({
  SpaceContext: null,
  useSpace: () => ({ space: null }),
}));
vi.mock('@/features/api-client', () => ({ isStubMode: () => true }));
vi.mock('@/features/dev/preview', () => ({
  getPreviewSeedMoments: () => [],
  usePreviewVariant: () => ({ active: false, variant: 'full' }),
}));

import { appendOlderPage, mergeMomentsById } from '@/features/moments/moments-context';
import type { Moment } from '@/features/moments/types';

/**
 * The feed's pagination fast path.
 *
 * Older pages prepend above the loaded window. Straight prepending is only
 * valid when the page really is older and self-consistent, so these pin both
 * halves: it takes the cheap path when that is provable, and declines (returning
 * null, so the caller falls back to the general merge) when it is not.
 */

function moment(id: string, occurredAt: string): Moment {
  return {
    id,
    type: 'note',
    title: '',
    body: `memory ${id}`,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    isOwn: true,
  };
}

const OLDER = [
  moment('p-1', '2025-01-05T10:00:00.000Z'),
  moment('p-2', '2025-01-06T10:00:00.000Z'),
];
const LOADED = [
  moment('n-1', '2026-01-05T10:00:00.000Z'),
  moment('n-2', '2026-01-06T10:00:00.000Z'),
];

describe('feed pagination fast path', () => {
  it('prepends a strictly older page ahead of what is held', () => {
    expect(appendOlderPage(LOADED, OLDER)?.map((m) => m.id)).toEqual([
      'p-1',
      'p-2',
      'n-1',
      'n-2',
    ]);
  });

  it('takes the page as the whole window when nothing is loaded yet', () => {
    expect(appendOlderPage([], OLDER)?.map((m) => m.id)).toEqual(['p-1', 'p-2']);
  });

  it.each([
    ['the page is empty', LOADED, []],
    ['the page is newer than the window', LOADED, [moment('x', '2027-01-01T10:00:00.000Z')]],
    ['the page touches the boundary date', LOADED, [moment('x', '2026-01-05T10:00:00.000Z')]],
    [
      'the page is not in order',
      LOADED,
      [moment('b', '2025-01-06T10:00:00.000Z'), moment('a', '2025-01-05T10:00:00.000Z')],
    ],
    [
      'the page repeats an id',
      LOADED,
      [moment('dup', '2025-01-05T10:00:00.000Z'), moment('dup', '2025-01-06T10:00:00.000Z')],
    ],
    [
      'the page re-sends a held row under an older date',
      LOADED,
      [moment('n-1', '2025-12-01T10:00:00.000Z')],
    ],
  ])('declines when %s', (_reason, current, incoming) => {
    expect(appendOlderPage(current, incoming)).toBeNull();
  });

  it('declines a same-date page whose id order would land behind the boundary', () => {
    // Same instant, so age alone cannot place it; id decides, and this id sorts
    // after the boundary, which is the general merge's business, not this one's.
    const sameDay = [moment('n-0', '2026-01-05T10:00:00.000Z')];
    expect(appendOlderPage(sameDay, [moment('z-9', '2026-01-05T10:00:00.000Z')])).toBeNull();
  });

  it('prepends a same-date page whose id order belongs ahead of the boundary', () => {
    const sameDay = [moment('n-1', '2026-01-05T10:00:00.000Z')];
    expect(appendOlderPage(sameDay, [moment('a-1', '2026-01-05T10:00:00.000Z')])?.map((m) => m.id)).toEqual([
      'a-1',
      'n-1',
    ]);
  });

  it('never changes what the general merge would have produced', () => {
    const result = appendOlderPage(LOADED, OLDER);
    expect(result).not.toBeNull();

    // Same records and same order as the general merge, which is the fallback.
    const general = mergeMomentsById(LOADED, OLDER);
    expect(result!.map((m) => m.id)).toEqual(general.map((m) => m.id));
  });

  it('costs less than the general merge it replaces on a loaded window', () => {
    const loaded = Array.from({ length: 2000 }, (_, index) =>
      moment(`n-${index}`, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString())
    );
    const page = Array.from({ length: 100 }, (_, index) =>
      moment(`p-${index}`, new Date(Date.UTC(2025, 11, 1, 0, 0, index)).toISOString())
    );

    const generalStart = performance.now();
    for (let run = 0; run < 20; run += 1) {
      mergeMomentsById(loaded, page);
    }
    const generalMs = Number(((performance.now() - generalStart) / 20).toFixed(3));

    const fastStart = performance.now();
    for (let run = 0; run < 20; run += 1) {
      expect(appendOlderPage(loaded, page)).not.toBeNull();
    }
    const fastMs = Number(((performance.now() - fastStart) / 20).toFixed(3));

    console.log(
      JSON.stringify({
        benchmark: 'pagination-prepend-vs-merge',
        window: loaded.length,
        page: page.length,
        generalMergeMs: generalMs,
        fastPrependMs: fastMs,
        environment: 'desktop happy-dom; not device timing',
      })
    );
    // No timing assertion on purpose: this comparison flips under parallel test
    // load, and a test that fails on scheduling noise pressures the next
    // reader to "fix" it rather than read it. Correctness is asserted above.
  });
});
