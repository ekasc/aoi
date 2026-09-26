import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  feedRowIndexForMomentId,
  firstUnreadPartnerId,
  galleryRowIndexForMomentId,
  loadSeenCursor,
  newestOccurredAt,
  saveSeenCursor,
  scrollListToIndexOrEnd,
  seenKey,
  unreadPartnerMoments,
} from '@/features/moments/seen-cursor';

const YOU = { id: 'mine', occurredAt: '2026-09-10T10:00:00.000Z', authorRole: 'you' } as const;
const THEIRS_OLD = {
  id: 'theirs-old',
  occurredAt: '2026-09-12T10:00:00.000Z',
  authorRole: 'partner',
} as const;
const THEIRS_NEW = {
  id: 'theirs-new',
  occurredAt: '2026-09-14T10:00:00.000Z',
  authorRole: 'partner',
} as const;

beforeEach(async () => {
  await globalThis.__mockAsyncStorage.clear();
});

describe('seen cursor storage', () => {
  it('scopes the key per space and round-trips', async () => {
    expect(seenKey('space-1')).not.toBe(seenKey('space-2'));
    expect(await loadSeenCursor('space-1')).toBeNull();

    await saveSeenCursor('space-1', '2026-09-14T10:00:00.000Z');
    expect(await loadSeenCursor('space-1')).toBe('2026-09-14T10:00:00.000Z');
    // Another space is untouched by the write.
    expect(await loadSeenCursor('space-2')).toBeNull();
  });

  it('treats garbage as no cursor rather than failing', async () => {
    await globalThis.__mockAsyncStorage.setItem(seenKey('space-1'), 'not-a-date');
    expect(await loadSeenCursor('space-1')).toBeNull();
  });
});

describe('newestOccurredAt', () => {
  it('takes the max over unsorted, gappy input', () => {
    expect(newestOccurredAt([THEIRS_NEW, YOU, THEIRS_OLD])).toBe('2026-09-14T10:00:00.000Z');
    expect(newestOccurredAt([])).toBeNull();
    expect(
      newestOccurredAt([{ id: 'x', occurredAt: 'junk', authorRole: 'you' }]),
    ).toBeNull();
  });
});

describe('unreadPartnerMoments', () => {
  it('returns only partner posts newer than the cursor, oldest first', () => {
    const unread = unreadPartnerMoments(
      [THEIRS_NEW, YOU, THEIRS_OLD],
      '2026-09-11T10:00:00.000Z',
    );
    expect(unread.map((moment) => moment.id)).toEqual(['theirs-old', 'theirs-new']);
  });

  it('answers empty on first run instead of calling the archive unread', () => {
    expect(unreadPartnerMoments([THEIRS_NEW, THEIRS_OLD], null)).toEqual([]);
  });

  it('answers empty when caught up', () => {
    expect(unreadPartnerMoments([THEIRS_NEW, YOU], '2026-09-14T10:00:00.000Z')).toEqual([]);
  });
});

describe('firstUnreadPartnerId', () => {
  it('names the oldest unread post to read forward from', () => {
    expect(
      firstUnreadPartnerId([THEIRS_NEW, YOU, THEIRS_OLD], '2026-09-11T10:00:00.000Z'),
    ).toBe('theirs-old');
    expect(firstUnreadPartnerId([YOU], '2026-09-11T10:00:00.000Z')).toBeNull();
  });
});

describe('row index lookup', () => {
  it('finds a moment row by id', () => {
    const rows = [
      { kind: 'month', key: 'month:2026-09' },
      { kind: 'moment', key: 'moment:a', moment: { id: 'a' } },
      { kind: 'moment', key: 'moment:b', moment: { id: 'b' } },
    ];
    expect(feedRowIndexForMomentId(rows, 'b')).toBe(2);
    expect(feedRowIndexForMomentId(rows, 'missing')).toBe(-1);
  });

  it('finds the grid row holding a moment', () => {
    const rows = [
      { kind: 'month', key: 'month:2026-09' },
      { kind: 'grid', key: 'grid:0', items: [{ momentId: 'a' }, { momentId: 'b' }] },
      { kind: 'grid', key: 'grid:1', items: [{ momentId: 'c' }] },
    ];
    expect(galleryRowIndexForMomentId(rows, 'b')).toBe(1);
    expect(galleryRowIndexForMomentId(rows, 'c')).toBe(2);
    expect(galleryRowIndexForMomentId(rows, 'missing')).toBe(-1);
  });
});

describe('scrollListToIndexOrEnd', () => {
  it('places a known row near the top, never at the mercy of measurement', () => {
    const scrollToIndex = vi.fn();
    const scrollToEnd = vi.fn(() => {
      throw new Error('must not fall back when the row placed');
    });
    scrollListToIndexOrEnd({ scrollToIndex, scrollToEnd }, 4);
    expect(scrollToIndex).toHaveBeenCalledWith({ animated: false, index: 4, viewPosition: 0.2 });
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('falls back to the end when the row is unknown or unplaceable', () => {
    const scrollToEnd = vi.fn();
    scrollListToIndexOrEnd(
      {
        scrollToIndex: () => {
          throw new Error('unmeasured');
        },
        scrollToEnd,
      },
      4,
    );
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    scrollListToIndexOrEnd({ scrollToEnd }, -1);
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
  });
});
