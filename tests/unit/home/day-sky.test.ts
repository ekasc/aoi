import { describe, expect, it } from 'vitest';

import { toDayKey } from '@/features/calendar/calendar-date-utils';
import { buildDaySky, formatDaySkyCaption } from '@/features/home/day-sky';
import { getDaysTogether } from '@/features/time-together/time-together';

function makeMoment(id: string, occurredAt: string, authorRole: 'you' | 'partner' = 'partner') {
  return {
    id,
    type: 'note' as const,
    title: `Title ${id}`,
    body: 'body',
    occurredAt,
    createdAt: occurredAt,
    authorId: authorRole === 'partner' ? 'user_partner' : 'user_you',
    authorRole,
    authorName: authorRole === 'partner' ? 'Alex' : 'You',
  };
}

function localNoonIso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).toISOString();
}

describe('day-sky day math (DST-safe local calendar days)', () => {
  it('counts the start day as day 1', () => {
    const now = new Date(2026, 1, 8, 12, 0, 0, 0);
    expect(getDaysTogether('2026-02-08', now)).toBe(1);
  });

  it('counts calendar-day diff + 1', () => {
    const now = new Date(2026, 1, 10, 12, 0, 0, 0);
    expect(getDaysTogether('2026-02-08', now)).toBe(3);
  });

  it('stays exact across the spring-forward DST weekend (23h Sunday)', () => {
    // 2026 US DST starts Mar 8: Mar 7 -> Mar 9 is 3 calendar days even
    // though elapsed wall time is 47h in DST zones.
    const now = new Date(2026, 2, 9, 12, 0, 0, 0);
    expect(getDaysTogether('2026-03-07', now)).toBe(3);
    const days = buildDaySky(3, [], '2026-03-07');
    expect(days?.map((d) => d.dayKey)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('stays exact across the fall-back DST weekend (25h Sunday)', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0, 0);
    expect(getDaysTogether('2026-10-31', now)).toBe(3);
    const days = buildDaySky(3, [], '2026-10-31');
    expect(days?.map((d) => d.dayKey)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('day 1 is the start-date local day', () => {
    const days = buildDaySky(2, [], '2026-02-08');
    expect(days).toHaveLength(2);
    expect(days?.[0]).toMatchObject({ dayIndex: 0, dayKey: '2026-02-08' });
    expect(days?.[1]).toMatchObject({ dayIndex: 1, dayKey: '2026-02-09' });
  });

  it('returns null for unknown (0/undefined/missing/invalid/future)', () => {
    expect(buildDaySky(null, [], '2026-02-08')).toBeNull();
    expect(buildDaySky(undefined, [], '2026-02-08')).toBeNull();
    expect(buildDaySky(0, [], '2026-02-08')).toBeNull();
    expect(buildDaySky(-2, [], '2026-02-08')).toBeNull();
    expect(buildDaySky(5, [], null)).toBeNull();
    expect(buildDaySky(5, [], undefined)).toBeNull();
    expect(buildDaySky(5, [], '')).toBeNull();
    expect(buildDaySky(5, [], 'not-a-date')).toBeNull();
    const future = new Date(2026, 1, 7, 12, 0, 0, 0);
    expect(getDaysTogether('2026-02-08', future)).toBeNull();
  });
});

describe('day-sky memory mapping + colors', () => {
  it('marks memory-less days as dim with null author', () => {
    const days = buildDaySky(3, [], '2026-02-08');
    expect(days?.every((d) => d.hasMemory === false && d.authorRole === null)).toBe(true);
  });

  it('glows partner days as partner and yours as you', () => {
    const moments = [
      makeMoment('p1', localNoonIso(2026, 1, 8), 'partner'),
      makeMoment('y1', localNoonIso(2026, 1, 9), 'you'),
    ];
    const days = buildDaySky(3, moments, '2026-02-08');
    expect(days?.[0]).toMatchObject({ hasMemory: true, authorRole: 'partner' });
    expect(days?.[1]).toMatchObject({ hasMemory: true, authorRole: 'you' });
    expect(days?.[2]).toMatchObject({ hasMemory: false, authorRole: null });
  });

  it('merges shared days to partner (accent)', () => {
    const moments = [
      makeMoment('y1', localNoonIso(2026, 1, 8), 'you'),
      makeMoment('p1', localNoonIso(2026, 1, 8), 'partner'),
    ];
    const days = buildDaySky(2, moments, '2026-02-08');
    expect(days?.[0]).toMatchObject({ hasMemory: true, authorRole: 'partner' });
  });

  it('ignores memories outside the range and bad dates', () => {
    const moments = [
      makeMoment('before', localNoonIso(2026, 1, 7), 'partner'),
      makeMoment('after', localNoonIso(2026, 1, 20), 'partner'),
      makeMoment('bad', 'not-a-date', 'partner'),
    ];
    const days = buildDaySky(3, moments, '2026-02-08');
    expect(days?.every((d) => !d.hasMemory)).toBe(true);
  });

  it('buckets by local calendar day (toDayKey round-trip)', () => {
    const iso = localNoonIso(2026, 1, 8);
    const key = toDayKey(new Date(iso));
    const days = buildDaySky(1, [makeMoment('m1', iso, 'you')], '2026-02-08');
    expect(key).toBe('2026-02-08');
    expect(days?.[0].hasMemory).toBe(true);
  });
});

describe('day-sky unbounded growth', () => {
  it('represents every day together (no silent cap)', () => {
    const days = buildDaySky(200, [], '2024-01-01');
    expect(days).toHaveLength(200);
    const years = buildDaySky(800, [], '2024-01-01');
    expect(years).toHaveLength(800);
  });

  it('keeps oldest days first and stays stable as days grow', () => {
    const moments = [makeMoment('p1', localNoonIso(2024, 0, 1), 'partner')];
    const small = buildDaySky(200, moments, '2024-01-01');
    const grown = buildDaySky(400, moments, '2024-01-01');
    expect(small).toHaveLength(200);
    expect(grown).toHaveLength(400);
    expect(grown?.slice(0, 200)).toEqual(small);
    expect(grown?.[0]).toMatchObject({ dayIndex: 0, hasMemory: true });
    // Oldest-first order: indices ascend.
    expect(grown?.map((d) => d.dayIndex)).toEqual(Array.from({ length: 400 }, (_, i) => i));
  });
});

describe('day-sky caption', () => {
  it('uses singular for 1 day and plural otherwise', () => {
    expect(formatDaySkyCaption(1)).toBe('1 day lighting your sky');
    expect(formatDaySkyCaption(2)).toBe('2 days lighting your sky');
    expect(formatDaySkyCaption(50)).toBe('50 days lighting your sky');
  });
});
