import { describe, expect, it } from 'vitest';

import {
  formatDaysTogether,
  formatMomentsKept,
  getDaysTogether,
} from '@/features/time-together/time-together';

function date(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid test date: ${value}`);
  }
  return parsed;
}

describe('getDaysTogether', () => {
  it('counts the start date itself as day 1', () => {
    expect(getDaysTogether('2026-08-03', date('2026-08-03T09:00:00'))).toBe(1);
    // Late in the evening of the start day is still day 1.
    expect(getDaysTogether('2026-08-03', date('2026-08-03T23:59:59'))).toBe(1);
  });

  it('rolls over at midnight, not at the exact hour', () => {
    // Started late on Aug 3; early on Aug 4 is already day 2.
    expect(getDaysTogether('2026-08-03T23:30:00', date('2026-08-04T00:30:00'))).toBe(2);
  });

  it('counts the next day as day 2', () => {
    expect(getDaysTogether('2026-08-03', date('2026-08-04T12:00:00'))).toBe(2);
  });

  it('counts a full week as 8 days inclusive', () => {
    expect(getDaysTogether('2026-08-03', date('2026-08-10T12:00:00'))).toBe(8);
  });

  it('handles a leap-year February correctly', () => {
    // Feb 28 = day 1, Feb 29 = day 2, Mar 1 = day 3.
    expect(getDaysTogether('2024-02-28', date('2024-03-01T12:00:00'))).toBe(3);
    // One full leap year: Feb 29 2024 -> Feb 28 2025 is 365 days apart, so 366 inclusive.
    expect(getDaysTogether('2024-02-29', date('2025-02-28T12:00:00'))).toBe(366);
    expect(getDaysTogether('2024-02-29', date('2025-03-01T12:00:00'))).toBe(367);
  });

  it('handles a non-leap-year February correctly', () => {
    // Feb 28 = day 1, Mar 1 = day 2 (there is no Feb 29 in 2023).
    expect(getDaysTogether('2023-02-28', date('2023-03-01T12:00:00'))).toBe(2);
  });

  it('crosses year boundaries', () => {
    expect(getDaysTogether('2025-12-31', date('2026-01-01T12:00:00'))).toBe(2);
    // 2024 is a leap year: 366 days in the year, inclusive count 367.
    expect(getDaysTogether('2024-01-01', date('2024-12-31T12:00:00'))).toBe(366);
    expect(getDaysTogether('2023-01-01', date('2023-12-31T12:00:00'))).toBe(365);
  });

  it('accepts full timestamps as well as date-only strings', () => {
    expect(getDaysTogether('2026-08-03T18:45:00', date('2026-08-03T20:00:00'))).toBe(1);
    expect(getDaysTogether('2026-08-03T18:45:00', date('2026-08-05T20:00:00'))).toBe(3);
  });

  it('returns null for a future start date', () => {
    expect(getDaysTogether('2026-08-04', date('2026-08-03T12:00:00'))).toBeNull();
  });

  it('returns null for missing or invalid dates', () => {
    expect(getDaysTogether('', date('2026-08-03T12:00:00'))).toBeNull();
    expect(getDaysTogether(null, date('2026-08-03T12:00:00'))).toBeNull();
    expect(getDaysTogether(undefined, date('2026-08-03T12:00:00'))).toBeNull();
    expect(getDaysTogether('not-a-date', date('2026-08-03T12:00:00'))).toBeNull();
  });
});

describe('formatDaysTogether', () => {
  it('keeps day 1 singular', () => {
    expect(formatDaysTogether(1)).toBe('1 day together');
  });

  it('formats larger counts with separators', () => {
    expect(formatDaysTogether(2847)).toBe('2,847 days together');
  });
});

describe('formatMomentsKept', () => {
  it('keeps a single moment singular', () => {
    expect(formatMomentsKept(1)).toBe('1 moment kept');
  });

  it('formats the quiet aggregate', () => {
    expect(formatMomentsKept(142)).toBe('142 moments kept');
    expect(formatMomentsKept(0)).toBe('0 moments kept');
  });
});
