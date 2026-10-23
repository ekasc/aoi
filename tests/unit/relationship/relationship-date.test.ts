import { describe, it, expect, afterEach } from 'vitest';

import { formatRelationshipDate } from '@/features/relationship/relationship-date';

const originalTimezone = process.env.TZ;

function restoreTimezone() {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
}

/** Run with a fixed timezone, the way a reader's phone is fixed. */
function inTimezone<T>(timezone: string, run: () => T): T {
  process.env.TZ = timezone;
  try {
    return run();
  } finally {
    restoreTimezone();
  }
}

afterEach(() => {
  restoreTimezone();
});

describe('formatRelationshipDate', () => {
  it('keeps a date-only start on the day the couple chose, west of UTC', () => {
    // A calendar date is not an instant. Parsed as UTC midnight, 2022-06-14
    // is still June 13 in Vancouver: the exact bug this screen showed.
    expect(
      inTimezone('America/Vancouver', () => formatRelationshipDate('2022-06-14')),
    ).toBe('June 14, 2022');
  });

  it('keeps a date-only start on the day the couple chose, east of UTC', () => {
    expect(
      inTimezone('Asia/Tokyo', () => formatRelationshipDate('2022-06-14')),
    ).toBe('June 14, 2022');
  });

  it('still formats a legitimate timestamp as its local calendar day', () => {
    expect(
      inTimezone('UTC', () => formatRelationshipDate('2022-06-14T23:30:00.000Z')),
    ).toBe('June 14, 2022');
  });

  it('reports an unreadable start as absent instead of guessing a day', () => {
    expect(formatRelationshipDate('not a date')).toBeNull();
    expect(formatRelationshipDate('')).toBeNull();
    expect(formatRelationshipDate(null)).toBeNull();
    expect(formatRelationshipDate(undefined)).toBeNull();
  });
});
