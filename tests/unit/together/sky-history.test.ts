import { describe, expect, it } from 'vitest';

import {
  clampSkyHistoryIndex,
  eventsAsOf,
  formatRelationshipAge,
  lettersAsOf,
  skyHistoryMonths,
} from '@/features/home/sky-history';
import { usHistory } from '@/features/home/us-history';
import { findReadyLetter } from '@/features/home/us-focal';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Letter } from '@/features/letters/types';
import type { Moment } from '@/features/moments/types';

const now = new Date('2026-09-15T20:00:00');

const memory = (id: string, occurredAt: string, type: Moment['type'] = 'note'): Moment => ({
  id,
  occurredAt,
  type,
  title: id,
  body: '',
  createdAt: occurredAt,
  authorId: 'you',
  authorName: 'Maya',
  authorRole: 'you',
});

const letter = (id: string, sealedUntil: string, createdAt: string): Letter => ({
  id,
  authorRole: 'you',
  authorName: 'Maya',
  caption: null,
  sealedUntil,
  createdAt,
  isOpened: false,
  readyToOpen: false,
  openedAt: null,
});

const event = (id: string, startsAt: string, endsAt: string, createdAt: string): CalendarEvent => ({
  id,
  title: id,
  startsAt,
  endsAt,
  actor: 'you',
  actorName: 'Maya',
  label: { preset: 'Date' },
  createdAt,
  updatedAt: createdAt,
});

describe('sky history range', () => {
  it('offers the start day, calendar months, and today', () => {
    const months = skyHistoryMonths('2024-09-15', now);
    expect(months).toHaveLength(26);
    expect(months[0].label).toBe('Sep 15, 2024');
    expect(formatRelationshipAge('2024-09-15', months[0].asOf)).toBe('1 day together');
    expect(months.at(-1)?.label).toBe('Today');
    expect(months.at(-1)?.asOf).toEqual(now);
  });

  it('has no axis before a start date is known or when it is still ahead', () => {
    expect(skyHistoryMonths(null, now)).toEqual([]);
    expect(skyHistoryMonths('2027-01-01', now)).toEqual([]);
  });

  it('treats a relationship started today as a single stop', () => {
    const months = skyHistoryMonths('2026-09-15', now);
    expect(months).toHaveLength(1);
    expect(months[0].asOf).toEqual(now);
  });

  it('reaches the start even inside the first month', () => {
    const months = skyHistoryMonths('2026-09-01', now);
    expect(months.map((month) => month.label)).toEqual(['Sep 1, 2026', 'Today']);
  });

  it('adds a stop as soon as a second month begins', () => {
    const months = skyHistoryMonths('2026-08-20', now);
    expect(months.map((month) => month.label)).toEqual(['Aug 20, 2026', 'Aug 2026', 'Today']);
  });

  it('never runs a stop past today, even mid-month', () => {
    const months = skyHistoryMonths('2026-09-01', now);
    for (const month of months) {
      expect(month.asOf.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('clamps a stale or invalid selection into the relationship', () => {
    expect(clampSkyHistoryIndex(-4, 10)).toBe(0);
    expect(clampSkyHistoryIndex(99, 10)).toBe(9);
    expect(clampSkyHistoryIndex(Number.NaN, 10)).toBe(9);
    expect(clampSkyHistoryIndex(2, 0)).toBe(0);
  });

  it('reaches relationship start, earlier months, and today', () => {
    const months = skyHistoryMonths('2022-06-14', now);
    expect(months[0].label).toBe('Jun 14, 2022');
    expect(months.at(-1)?.isToday).toBe(true);
  });
});

describe('relationship age at a vantage point', () => {
  it('counts whole calendar months, never a future duration', () => {
    expect(formatRelationshipAge('2024-09-15', now)).toBe('2 years together');
    expect(formatRelationshipAge('2024-03-15', now)).toBe('2 years, 6 months together');
    expect(formatRelationshipAge('2026-01-15', now)).toBe('8 months together');
    expect(formatRelationshipAge('2026-08-15', now)).toBe('1 month together');
    expect(formatRelationshipAge('2024-09-14', now)).toBe('2 years together');
  });

  it('holds back the final month until its day arrives', () => {
    // A day short of the anniversary is not the anniversary yet.
    expect(formatRelationshipAge('2024-09-16', now)).toBe('1 year, 11 months together');
    expect(formatRelationshipAge('2024-09-15', now)).toBe('2 years together');
  });

  it('falls back to days while the relationship is younger than a month', () => {
    expect(formatRelationshipAge('2026-09-15', now)).toBe('1 day together');
    expect(formatRelationshipAge('2026-09-05', now)).toBe('11 days together');
  });

  it('has nothing to say without a start date, or before it', () => {
    expect(formatRelationshipAge(null, now)).toBe('');
    expect(formatRelationshipAge('2027-01-01', now)).toBe('');
  });

  it('handles a leap-day start without drifting a day per year', () => {
    expect(formatRelationshipAge('2024-02-29', new Date('2026-02-28T12:00:00'))).toBe('1 year, 11 months together');
  });
});

describe('the sky at a past month', () => {
  it('renders only the relationship days that had elapsed', () => {
    const asOf = skyHistoryMonths('2024-01-01', now)[1].asOf;
    const sky = usHistory([memory('m', '2024-01-30T12:00:00')], '2024-01-01', asOf);
    expect(sky.daysTogether).toBe(31);
    expect(usHistory([], '2024-01-01', now).daysTogether).toBe(989);
  });

  it('is deterministic: the same month always produces the same sky', () => {
    const moments = [memory('a', '2024-03-04T12:00:00'), memory('b', '2024-03-09T12:00:00')];
    const first = skyHistoryMonths('2024-01-01', now)[3];
    const again = skyHistoryMonths('2024-01-01', now)[3];
    expect(first.asOf).toEqual(again.asOf);
    expect(usHistory(moments, '2024-01-01', first.asOf).daysTogether)
      .toBe(usHistory(moments, '2024-01-01', again.asOf).daysTogether);
    expect(usHistory(moments, '2024-01-01', first.asOf).moments.map((item) => item.id))
      .toEqual(['a', 'b']);
  });

  it('includes a memory kept on the selected day itself', () => {
    const asOf = skyHistoryMonths('2024-01-01', now)[2].asOf;
    const sameDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate(), 8, 0, 0).toISOString();
    expect(usHistory([memory('same-day', sameDay)], '2024-01-01', asOf).moments.map((m) => m.id)).toEqual(['same-day']);
  });

  it('leaves an early month honestly sparse rather than inventing content', () => {
    const asOf = skyHistoryMonths('2024-01-01', now)[0].asOf;
    const history = usHistory([memory('later', '2026-01-05T12:00:00')], '2024-01-01', asOf);
    expect(history.moments).toEqual([]);
    expect(history.story).toEqual([]);
    expect(history.chapters).toEqual([]);
    expect(history.resurface).toBeNull();
    expect(history.daysTogether).toBe(1);
  });
});

describe('content after the selected month is not visible', () => {
  const months = skyHistoryMonths('2024-01-01', now);
  const october2024 = months.find((month) => month.label === 'Oct 2024')!;
  const january2025 = months.find((month) => month.label === 'Jan 2025')!;

  it('excludes memories after the vantage and keeps those before it', () => {
    const moments = [memory('before', '2024-10-20T12:00:00'), memory('inside', '2024-10-31T12:00:00'), memory('after', '2025-01-02T12:00:00')];
    const history = usHistory(moments, '2024-01-01', october2024.asOf);
    expect(history.moments.map((item) => item.id)).toEqual(['before', 'inside']);
    expect(history.story.map((item) => item.id)).toEqual(['before', 'inside']);
  });

  it('resurfaces against the selected month, not against today', () => {
    const onThisDay = memory('on-this-day', '2024-10-15T12:00:00');
    // Today, one year on.
    expect(usHistory([onThisDay], '2024-01-01', new Date('2026-10-15T20:00:00')).resurface?.moment.id).toBe('on-this-day');
    // Standing in October 2025: the Oct 2024 memory is this month's echo.
    expect(usHistory([onThisDay], '2024-01-01', new Date('2025-10-15T20:00:00')).resurface?.moment.id).toBe('on-this-day');
    // Standing in the month it was kept: nothing is a year old yet.
    expect(usHistory([onThisDay], '2024-01-01', october2024.asOf).resurface).toBeNull();
    // Standing in an unrelated month: no match on month/day.
    expect(usHistory([onThisDay], '2024-01-01', january2025.asOf).resurface).toBeNull();
  });

  it('hides constellations for years that had not happened', () => {
    const years = [2024, 2025, 2026].flatMap((year) => [memory(`${year}-a`, `${year}-07-01T12:00:00`), memory(`${year}-b`, `${year}-08-01T12:00:00`)]);
    expect(usHistory(years, '2024-01-01', now).chapters.map((chapter) => chapter.id)).toEqual(['anniversary:2:2026', 'anniversary:1:2025']);
    // Standing inside year 1: the year-1 range has not closed, and later
    // years have not been reached.
    expect(usHistory(years, '2024-01-01', october2024.asOf).chapters).toEqual([]);
    expect(usHistory(years, '2024-01-01', january2025.asOf).chapters.map((chapter) => chapter.id)).toEqual(['anniversary:1:2025']);
  });

  it('hides plans and letters written after the vantage', () => {
    const asOf = october2024.asOf;
    expect(lettersAsOf([letter('later', '2024-11-01T09:00:00', '2024-11-05T10:00:00'), letter('earlier', '2024-10-20T09:00:00', '2024-01-02T10:00:00')], asOf).map((item) => item.id))
      .toEqual(['earlier']);
    expect(eventsAsOf([event('later', '2024-12-01T18:00:00', '2024-12-01T20:00:00', '2024-11-01T10:00:00'), event('earlier', '2024-09-01T18:00:00', '2024-09-01T20:00:00', '2024-08-01T10:00:00')], asOf).map((item) => item.id))
      .toEqual(['earlier']);
  });

  it('keeps a future-sealed letter hidden while the reader stands before its seal', () => {
    const sealed = letter('sealed', '2024-12-01T09:00:00', '2024-01-01T10:00:00');
    // Written in January, opens in December: June must not reveal it.
    const june = skyHistoryMonths('2024-01-01', now).find((month) => month.label === 'Jun 2024')!.asOf;
    expect(lettersAsOf([sealed], june).map((item) => item.id)).toEqual(['sealed']);
    expect(findReadyLetter(lettersAsOf([sealed], june), june)).toBeNull();
    expect(findReadyLetter(lettersAsOf([sealed], now), now)?.id).toBe('sealed');
  });
});