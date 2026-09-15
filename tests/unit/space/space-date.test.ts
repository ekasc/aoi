import { describe, expect, it } from 'vitest';

import { toApiDateString } from '../../../features/space/space-date';

describe('toApiDateString', () => {
  it('formats a date as YYYY-MM-DD (local calendar date)', () => {
    expect(toApiDateString(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toApiDateString(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('pads month and day with leading zeros', () => {
    expect(toApiDateString(new Date(2024, 2, 7))).toBe('2024-03-07');
  });

  it('never drifts across timezones (local, not UTC)', () => {
    // 2024-06-15T23:30 local: UTC date would be the 16th if converted via
    // toISOString — the API needs the local calendar date the user picked.
    const lateEvening = new Date(2024, 5, 15, 23, 30);
    expect(toApiDateString(lateEvening)).toBe('2024-06-15');

    const earlyMorning = new Date(2024, 5, 15, 0, 30);
    expect(toApiDateString(earlyMorning)).toBe('2024-06-15');
  });

  it('matches the shared schema regex /^\\d{4}-\\d{2}-\\d{2}$/', () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(toApiDateString(new Date(2026, 1, 2)))).toBe(true);
  });
});
