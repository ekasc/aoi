import { describe, expect, test } from 'vitest';
import { getWeekBounds, isInWeek } from '../../../features/calendar/calendar-date-utils';

describe('getWeekBounds', () => {
  test('returns Sunday as start for a Wednesday', () => {
    const wednesday = new Date('2026-03-25T12:00:00Z'); // Wednesday
    const { weekStart, weekEnd } = getWeekBounds(wednesday);
    expect(weekStart.getDay()).toBe(0); // Sunday
    expect(weekEnd.getDay()).toBe(0); // next Sunday
    expect(weekEnd.getTime() - weekStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('returns same day when now is Sunday', () => {
    const sunday = new Date('2026-03-22T08:00:00Z');
    const { weekStart } = getWeekBounds(sunday);
    expect(weekStart.getDay()).toBe(0);
    expect(weekStart.getDate()).toBe(sunday.getDate());
  });
});

describe('isInWeek', () => {
  test('returns true for a date in the same week', () => {
    const now = new Date('2026-03-25T12:00:00Z'); // Wednesday
    const target = new Date('2026-03-27T18:00:00Z'); // Friday same week
    expect(isInWeek(target, now)).toBe(true);
  });

  test('returns false for a date in the next week', () => {
    const now = new Date('2026-03-25T12:00:00Z');
    const target = new Date('2026-03-30T18:00:00Z'); // Monday next week
    expect(isInWeek(target, now)).toBe(false);
  });

  test('returns false for a past date in a prior week', () => {
    const now = new Date('2026-03-25T12:00:00Z');
    const target = new Date('2026-03-20T12:00:00Z'); // prior Friday
    expect(isInWeek(target, now)).toBe(false);
  });
});
