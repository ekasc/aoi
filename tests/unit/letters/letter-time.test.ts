import { describe, it, expect } from 'vitest';
import type { Letter } from '@aoi/shared';

import {
  formatOpenedDayLabel,
  formatOpensInLabel,
  formatSealDayLabel,
  getNextAnniversary,
  getSealDateInMonths,
  getSealDateInYears,
  isLetterReadyToOpen,
} from '@/features/letters/letter-time';

// A fixed local "now": August 3, 2026 at midday. All fixture dates are
// built from local-time components so the suite is timezone-safe.
const NOW = new Date(2026, 7, 3, 12, 0, 0);

function letterWithSeal(sealedUntil: string): Pick<Letter, 'sealedUntil'> {
  return { sealedUntil };
}

describe('isLetterReadyToOpen', () => {
  it('is not ready before the seal day', () => {
    const letter = letterWithSeal(new Date(2026, 7, 3, 18).toISOString());
    expect(isLetterReadyToOpen(letter, NOW)).toBe(false);
  });

  it('is ready at the exact seal moment', () => {
    const due = new Date(2026, 7, 3, 12, 0, 0);
    expect(isLetterReadyToOpen(letterWithSeal(due.toISOString()), NOW)).toBe(true);
  });

  it('is ready once the seal moment has passed', () => {
    const letter = letterWithSeal(new Date(2026, 6, 1, 9).toISOString());
    expect(isLetterReadyToOpen(letter, NOW)).toBe(true);
  });

  it('never opens on an invalid date', () => {
    expect(isLetterReadyToOpen(letterWithSeal('not-a-date'), NOW)).toBe(false);
  });
});

describe('formatOpensInLabel', () => {
  it('says "Ready to open" once due', () => {
    expect(formatOpensInLabel(new Date(2026, 7, 2, 9).toISOString(), NOW)).toBe(
      'Ready to open'
    );
  });

  it('falls back to a quiet "Waiting" for invalid dates', () => {
    expect(formatOpensInLabel('not-a-date', NOW)).toBe('Waiting');
  });

  it('says "Opens today" later the same day', () => {
    expect(formatOpensInLabel(new Date(2026, 7, 3, 21).toISOString(), NOW)).toBe(
      'Opens today'
    );
  });

  it('says "Opens tomorrow" one calendar day out', () => {
    expect(formatOpensInLabel(new Date(2026, 7, 4, 21).toISOString(), NOW)).toBe(
      'Opens tomorrow'
    );
  });

  it('counts days up to 45', () => {
    expect(formatOpensInLabel(new Date(2026, 7, 13, 9).toISOString(), NOW)).toBe(
      'Opens in 10 days'
    );
    expect(formatOpensInLabel(new Date(2026, 8, 17, 9).toISOString(), NOW)).toBe(
      'Opens in 45 days'
    );
  });

  it('switches to "about a month" beyond 45 days', () => {
    // 40 days is within the day bucket; 46 tips into months (rounds to 2).
    expect(formatOpensInLabel(new Date(2026, 8, 18, 9).toISOString(), NOW)).toBe(
      'Opens in about 2 months'
    );
  });

  it('counts months under a year', () => {
    expect(formatOpensInLabel(new Date(2026, 11, 12, 9).toISOString(), NOW)).toBe(
      'Opens in about 4 months'
    );
  });

  it('says "about a year" around 365 days', () => {
    expect(formatOpensInLabel(new Date(2027, 7, 3, 9).toISOString(), NOW)).toBe(
      'Opens in about a year'
    );
  });

  it('counts years beyond that', () => {
    expect(formatOpensInLabel(new Date(2028, 7, 1, 9).toISOString(), NOW)).toBe(
      'Opens in about 2 years'
    );
  });
});

describe('formatOpenedDayLabel / formatSealDayLabel', () => {
  it('formats the day a letter opened', () => {
    const opened = new Date(2026, 7, 3, 12);
    expect(formatOpenedDayLabel(opened.toISOString())).toBe('August 3, 2026');
  });

  it('formats the day a letter will open', () => {
    const due = new Date(2026, 8, 3, 9);
    expect(formatSealDayLabel(due.toISOString())).toBe('September 3, 2026');
  });

  it('returns an empty string for invalid dates', () => {
    expect(formatOpenedDayLabel('not-a-date')).toBe('');
  });
});

describe('getSealDateInMonths', () => {
  it('lands on the same day next month at 9am', () => {
    const result = getSealDateInMonths(new Date(2026, 7, 3, 15), 1);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8); // September
    expect(result.getDate()).toBe(3);
    expect(result.getHours()).toBe(9);
  });

  it('clamps the day into shorter months', () => {
    const result = getSealDateInMonths(new Date(2026, 0, 31, 15), 1);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February 2026 has 28 days
    expect(result.getDate()).toBe(28);
  });

  it('rolls across the year boundary', () => {
    const result = getSealDateInMonths(new Date(2026, 10, 15, 8), 3);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(15);
  });
});

describe('getSealDateInYears', () => {
  it('lands on the same day a year later at 9am', () => {
    const result = getSealDateInYears(new Date(2026, 7, 3, 15), 1);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(7);
    expect(result.getDate()).toBe(3);
    expect(result.getHours()).toBe(9);
  });

  it('clamps leap-day starts into non-leap years', () => {
    const result = getSealDateInYears(new Date(2024, 1, 29, 10), 1);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });
});

describe('getNextAnniversary', () => {
  it('returns null when the relationship start is missing or invalid', () => {
    expect(getNextAnniversary(null, NOW)).toBeNull();
    expect(getNextAnniversary(undefined, NOW)).toBeNull();
    expect(getNextAnniversary('', NOW)).toBeNull();
    expect(getNextAnniversary('not-a-date', NOW)).toBeNull();
  });

  it('finds the next whole-year anniversary at 9am', () => {
    // Started June 15, 2023 — the next whole-year mark after Aug 3, 2026
    // is June 15, 2027.
    const result = getNextAnniversary('2023-06-15', NOW);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2027);
    expect(result!.getMonth()).toBe(5);
    expect(result!.getDate()).toBe(15);
    expect(result!.getHours()).toBe(9);
  });

  it('still offers this year’s anniversary when the day has not arrived yet', () => {
    // Started Aug 20, 2024; now is Aug 3, 2026 — the 2-year mark on
    // Aug 20, 2026 is still ahead and must win over 2027's.
    const result = getNextAnniversary('2024-08-20', NOW);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(7);
    expect(result!.getDate()).toBe(20);
  });

  it('rolls to next year once this year’s anniversary has passed', () => {
    // Started May 10, 2024; now is Aug 3, 2026 — May 10, 2026 is behind us.
    const result = getNextAnniversary('2024-05-10', NOW);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2027);
    expect(result!.getMonth()).toBe(4);
    expect(result!.getDate()).toBe(10);
  });

  it('accepts a full ISO datetime', () => {
    const result = getNextAnniversary('2023-06-15T18:30:00.000Z', NOW);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2027);
  });

  it('clamps start days into shorter months', () => {
    // Started Feb 29 (leap year) — 2027's February clamps to the 28th.
    const result = getNextAnniversary('2024-02-29', NOW);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2027);
    expect(result!.getMonth()).toBe(1);
    expect(result!.getDate()).toBe(28);
  });
});
