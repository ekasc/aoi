import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buildChaptersFromBuckets,
  describeChapter,
  filterChapterRange,
  monthRange,
  previousMonthKey,
  summarizeBuckets,
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

describe('monthRange / previousMonthKey', () => {
  test('month bounds are exact local-month edges', () => {
    const range = monthRange('2026-08');
    expect(range).toEqual({
      fromMs: new Date(2026, 7, 1).getTime(),
      toMs: new Date(2026, 8, 1).getTime(),
    });
    expect(previousMonthKey(new Date(2026, 8, 15), 1)).toBe('2026-08');
    expect(previousMonthKey(new Date(2026, 8, 15), 2)).toBe('2026-07');
  });
});

describe('buildChaptersFromBuckets monthly grouping', () => {
  test('groups completed months with stable ids and ranges', () => {
    const chapters = buildChaptersFromBuckets(
      [bucket('2026-08', 3), bucket('2026-07', 1), bucket('2026-09', 4)],
      null,
      NOW
    );

    // Current incomplete month excluded.
    expect(chapters.map((chapter) => chapter.id)).toEqual([
      'month:2026-08',
      'month:2026-07',
    ]);
    const august = chapters[0];
    expect(august.range).toEqual(monthRange('2026-08'));
    expect(august.subtitle).toBe('3 memories');
    expect(august.memoryIds).toEqual([]);
  });

  test('skips zero-count buckets but keeps them as coverage', () => {
    const chapters = buildChaptersFromBuckets(
      [bucket('2026-08', 0), bucket('2026-07', 1)],
      null,
      NOW
    );

    expect(chapters.map((chapter) => chapter.id)).toEqual(['month:2026-07']);
  });

  test('is deterministic for the same buckets in any input order', () => {
    const rows = [
      bucket('2026-08', 2, 'https://cdn.test/c.jpg'),
      bucket('2026-07', 1),
    ];
    const first = buildChaptersFromBuckets(rows, null, NOW);
    const second = buildChaptersFromBuckets([...rows].reverse(), null, NOW);

    expect(second).toEqual(first);
  });

  test('anniversary cover comes from the earliest covered month with photography', () => {
    const months = [
      '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    ];
    const rows = months.map((key) =>
      bucket(key, 1, key === '2024-10' ? 'https://cdn.test/oct.jpg' : key === '2024-08' ? 'https://cdn.test/aug.jpg' : null)
    );
    const chapters = buildChaptersFromBuckets(rows, '2024-06-15', new Date(2026, 8, 15, 12, 0, 0));

    const first = chapters.find((chapter) => chapter.id === 'anniversary:1:2025');
    expect(first?.coverPhotoUri).toBe('https://cdn.test/aug.jpg');
  });
});

describe('buildChaptersFromBuckets anniversaries', () => {
  test('null start date produces no anniversary chapter', () => {
    const chapters = buildChaptersFromBuckets([bucket('2025-06', 2)], null, NOW);

    expect(chapters.some((chapter) => chapter.kind === 'anniversary')).toBe(false);
  });

  test('completed annual windows produce correctly numbered chapters', () => {
    const months = [
      '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05',
      '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08',
    ];
    const rows = months.map((key) =>
      bucket(key, key === '2024-06' || key === '2025-06' ? 2 : 0)
    );
    const chapters = buildChaptersFromBuckets(rows, '2024-06-15', new Date(2026, 8, 15, 12, 0, 0));

    const anniversaries = chapters.filter((chapter) => chapter.kind === 'anniversary');
    expect(anniversaries.map((chapter) => chapter.id)).toEqual([
      'anniversary:2:2026',
      'anniversary:1:2025',
    ]);
    expect(anniversaries[0].title).toBe('Two years together');
    expect(anniversaries[0].range).toEqual({
      fromMs: new Date(2025, 5, 15).getTime(),
      toMs: new Date(2026, 5, 15).getTime(),
    });
  });

  test('partially covered windows wait for older pages', () => {
    // Window 2 spans 2025-06..2026-06 but only some months were fetched.
    const chapters = buildChaptersFromBuckets(
      [bucket('2026-08', 1), bucket('2026-01', 1)],
      '2024-06-15',
      new Date(2026, 8, 15, 12, 0, 0)
    );

    expect(chapters.some((chapter) => chapter.kind === 'anniversary')).toBe(false);
    // Monthly chapters still appear from what was fetched.
    expect(chapters.map((chapter) => chapter.id)).toEqual(['month:2026-08', 'month:2026-01']);
  });

  test('in-progress anniversary window is not a chapter', () => {
    const chapters = buildChaptersFromBuckets(
      [bucket('2026-08', 3)],
      '2024-06-15',
      new Date(2026, 8, 15, 12, 0, 0)
    );

    expect(chapters.some((chapter) => chapter.kind === 'anniversary')).toBe(false);
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

describe('summarizeBuckets (stub-local discovery)', () => {
  test('counts per bucket with earliest-photo covers, goals excluded', () => {
    const august = monthRange('2026-08');
    const result = summarizeBuckets(
      [
        makeMoment('note', localIso(2026, 7, 4)),
        makeMoment('late-photo', localIso(2026, 7, 4, 15), {
          type: 'media',
          mediaPreview: 'https://cdn.test/second.jpg',
        }),
        makeMoment('early-photo', localIso(2026, 7, 4, 8), {
          type: 'media',
          mediaPreview: 'https://cdn.test/first.jpg',
        }),
        makeMoment('goal', localIso(2026, 7, 4), { type: 'goal' }),
      ],
      [august]
    );

    expect(result.buckets).toEqual([
      { ...august, count: 3, cover: 'https://cdn.test/first.jpg' },
    ]);
    expect(result.hasOlder).toBe(false);
  });

  test('hasOlder is explicit when eligible memories predate the buckets', () => {
    const august = monthRange('2026-08');
    const result = summarizeBuckets(
      [makeMoment('old', localIso(2024, 2, 10))],
      [august]
    );

    expect(result.buckets).toEqual([{ ...august, count: 0, cover: null }]);
    expect(result.hasOlder).toBe(true);
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

    const buckets = summarizeBuckets(
      [makeMoment('summer-night', stamp)],
      [monthRange('2024-06'), july]
    );
    expect(buckets.buckets[0].count).toBe(0);
    expect(buckets.buckets[1].count).toBe(1);
  });

  test('anniversary windows respect the local start date across DST', () => {
    const described = describeChapter('anniversary:1:2025', '2024-06-15');
    expect(described?.range).toEqual({
      fromMs: new Date(2024, 5, 15).getTime(),
      toMs: new Date(2025, 5, 15).getTime(),
    });
  });
});
