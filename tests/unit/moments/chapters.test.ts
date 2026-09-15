import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  describeChapter,
  filterChapterRange,
  monthRange,
} from '@/features/moments/chapters';
import type { Moment } from '@/features/moments/types';

function makeMoment(id: string, occurredAt: string, overrides: Partial<Moment> = {}): Moment {
  return {
    id,
    type: 'note',
    title: `Moment ${id}`,
    body: '',
    occurredAt,
    targetAt: null,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    ...overrides,
  };
}

/** Local-calendar ISO helper: deterministic in any test timezone. */
function localIso(year: number, monthIndex: number, day: number, hour = 12): string {
  return new Date(year, monthIndex, day, hour, 0, 0).toISOString();
}

const NOW = new Date(2026, 8, 15, 12, 0, 0); // Sep 15 2026, local

function bucket(monthKey: string, count: number, cover: string | null = null) {
  const range = monthRange(monthKey);
  return { fromMs: range.fromMs, toMs: range.toMs, count, cover };
}

describe('monthRange', () => {
  test('month bounds are exact local-month edges', () => {
    const range = monthRange('2026-08');
    expect(range).toEqual({
      fromMs: new Date(2026, 7, 1).getTime(),
      toMs: new Date(2026, 8, 1).getTime(),
    });
  });
});

describe('describeChapter', () => {
  test('resolves monthly ids to titles and ranges without discovery', () => {
    expect(describeChapter('month:2026-08', null)).toEqual({
      title: 'August 2026',
      range: monthRange('2026-08'),
      kind: 'monthly',
    });
  });

  test('resolves anniversary ids against the start date', () => {
    expect(describeChapter('anniversary:2:2026', '2024-06-15')).toEqual({
      title: 'Two years together',
      range: {
        fromMs: new Date(2025, 5, 15).getTime(),
        toMs: new Date(2026, 5, 15).getTime(),
      },
      kind: 'anniversary',
    });
  });

  test('rejects unknown shapes and anniversary ids without a start date', () => {
    expect(describeChapter('week:2026-32', null)).toBeNull();
    expect(describeChapter('anniversary:2:2026', null)).toBeNull();
    expect(describeChapter('anniversary:9:2026', '2024-06-15')).toBeNull();
    expect(describeChapter('month:2026-13', null)).toBeNull();
  });
});

describe('filterChapterRange', () => {
  test('keeps eligible in-range memories oldest-first, excluding edges and goals', () => {
    const from = new Date(2026, 7, 1).getTime();
    const to = new Date(2026, 8, 1).getTime();
    const members = filterChapterRange(
      [
        makeMoment('before', new Date(2026, 6, 31, 23, 0, 0).toISOString()),
        makeMoment('late', localIso(2026, 7, 20)),
        makeMoment('early', localIso(2026, 7, 2)),
        makeMoment('goal', localIso(2026, 7, 10), { type: 'goal' }),
        makeMoment('at-end', new Date(2026, 8, 1).toISOString()),
      ],
      from,
      to
    );

    expect(members.map((moment) => moment.id)).toEqual(['early', 'late']);
  });
});

describe('historical timezone semantics (America/New_York DST)', () => {
  const REAL_TZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });

  afterEach(() => {
    if (REAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = REAL_TZ;
    }
  });

  test('winter and summer months use their own offsets, not one current offset', () => {
    // March is EST (UTC-5), July is EDT (UTC-4): a single fixed offset
    // cannot express both month starts.
    expect(monthRange('2024-03').fromMs).toBe(Date.UTC(2024, 2, 1, 5, 0, 0));
    expect(monthRange('2024-07').fromMs).toBe(Date.UTC(2024, 6, 1, 4, 0, 0));
  });

  test('a summer near-midnight memory lands in the summer chapter, not June', () => {
    // July 1, 00:30 local (EDT) = 04:30Z. Under a fixed winter offset
    // (EST, -300) this would bucket to June 30 23:30 — wrong chapter.
    const stamp = new Date(2024, 6, 1, 0, 30, 0).toISOString();
    const july = monthRange('2024-07');
    expect(new Date(stamp).getTime()).toBeGreaterThanOrEqual(july.fromMs);
    expect(new Date(stamp).getTime()).toBeLessThan(july.toMs);

    const members = filterChapterRange(
      [makeMoment('summer-night', stamp)],
      july.fromMs,
      july.toMs
    );
    expect(members.map((moment) => moment.id)).toEqual(['summer-night']);
  });

  test('anniversary windows respect the local start date across DST', () => {
    const described = describeChapter('anniversary:1:2025', '2024-06-15');
    expect(described?.range).toEqual({
      fromMs: new Date(2024, 5, 15).getTime(),
      toMs: new Date(2025, 5, 15).getTime(),
    });
  });
});
