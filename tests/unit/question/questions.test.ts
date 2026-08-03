import { describe, expect, it } from 'vitest';

import {
  WEEKLY_QUESTIONS,
  getIsoWeekParts,
  getQuestionIdForWeek,
  getWeekKeyForDate,
  getWeeklyQuestionForDate,
} from '@/features/question/question-of-the-week';

function date(value: string): Date {
  return new Date(value);
}

/** Mondays in August 2026 (2026-08-03 is a Monday in ISO week 32). */
function mondayOnOrAfterWeeksFrom(start: Date, weeks: number): Date {
  return new Date(start.getTime() + weeks * 7 * 86400000);
}

describe('WEEKLY_QUESTIONS', () => {
  it('seeds 20 handcrafted, non-empty, unique questions', () => {
    expect(WEEKLY_QUESTIONS).toHaveLength(20);
    for (const question of WEEKLY_QUESTIONS) {
      expect(question.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(WEEKLY_QUESTIONS).size).toBe(20);
  });
});

describe('getIsoWeekParts / getWeekKeyForDate', () => {
  it('formats week keys as YYYY-Www', () => {
    expect(getWeekKeyForDate(date('2026-08-03T12:00:00'))).toMatch(
      /^\d{4}-W\d{2}$/
    );
  });

  it('knows that 2026-08-03 (a Monday) opens ISO week 2026-W32', () => {
    expect(getIsoWeekParts(date('2026-08-03T00:00:00'))).toEqual({
      isoYear: 2026,
      isoWeek: 32,
    });
    expect(getWeekKeyForDate(date('2026-08-03T23:59:00'))).toBe('2026-W32');
  });

  it('keeps Sunday in the week that started the Monday before', () => {
    // Sunday 2026-08-09 still belongs to 2026-W32; Monday 2026-08-10 opens W33.
    expect(getWeekKeyForDate(date('2026-08-09T23:00:00'))).toBe('2026-W32');
    expect(getWeekKeyForDate(date('2026-08-10T00:00:00'))).toBe('2026-W33');
  });

  it('handles a 53-week ISO year boundary (2026 has 53 ISO weeks)', () => {
    // Monday 2026-12-28 opens the last week of ISO year 2026…
    expect(getWeekKeyForDate(date('2026-12-28T12:00:00'))).toBe('2026-W53');
    // …and Monday 2027-01-04 opens ISO year 2027.
    expect(getWeekKeyForDate(date('2027-01-04T12:00:00'))).toBe('2027-W01');
  });

  it('assigns week 1 to the week containing the first Thursday', () => {
    // 2027-01-01 is a Friday, so it still belongs to ISO week 2026-W53.
    expect(getWeekKeyForDate(date('2027-01-01T12:00:00'))).toBe('2026-W53');
  });

  it('is independent of the time of day', () => {
    const morning = getWeekKeyForDate(date('2026-08-05T06:00:00'));
    const evening = getWeekKeyForDate(date('2026-08-05T22:30:00'));
    expect(morning).toBe('2026-W32');
    expect(evening).toBe(morning);
  });
});

describe('getWeeklyQuestionForDate (week -> question mapping)', () => {
  it('is deterministic and identical for both partners', () => {
    const forYou = getWeeklyQuestionForDate(date('2026-08-05T09:00:00'));
    const forThem = getWeeklyQuestionForDate(date('2026-08-07T21:00:00'));
    // Two calls, same week — both partners see exactly the same question.
    expect(forYou).toEqual(forThem);
    expect(getWeeklyQuestionForDate(date('2026-08-05T09:00:00'))).toEqual(
      forYou
    );
  });

  it('maps every day of one week to the same question', () => {
    const monday = date('2026-08-03T12:00:00');
    const expected = getWeeklyQuestionForDate(monday);

    for (let day = 1; day < 7; day += 1) {
      expect(
        getWeeklyQuestionForDate(new Date(monday.getTime() + day * 86400000))
      ).toEqual(expected);
    }
  });

  it('lands on the expected question for a known week', () => {
    const week = getWeeklyQuestionForDate(date('2026-08-03T12:00:00'));
    expect(week.weekKey).toBe('2026-W32');
    // (2026 * 52 + 32) mod 20 = 4.
    expect(getQuestionIdForWeek({ isoYear: 2026, isoWeek: 32 })).toBe(4);
    expect(week.questionId).toBe(4);
    expect(week.question).toBe(WEEKLY_QUESTIONS[4]);
  });

  it('advances to the next question each consecutive week', () => {
    const start = date('2026-08-03T12:00:00');
    let previousId = getWeeklyQuestionForDate(start).questionId;

    for (let week = 1; week <= 19; week += 1) {
      const current = getWeeklyQuestionForDate(mondayOnOrAfterWeeksFrom(start, week));
      expect(current.questionId).toBe((previousId + 1) % WEEKLY_QUESTIONS.length);
      previousId = current.questionId;
    }
  });

  it('cycles through all 20 questions over 20 consecutive weeks', () => {
    const start = date('2026-08-03T12:00:00');
    const seen = new Set<number>();

    for (let week = 0; week < 20; week += 1) {
      const current = getWeeklyQuestionForDate(mondayOnOrAfterWeeksFrom(start, week));
      expect(current.questionId).toBeGreaterThanOrEqual(0);
      expect(current.questionId).toBeLessThan(WEEKLY_QUESTIONS.length);
      seen.add(current.questionId);
    }

    expect(seen.size).toBe(WEEKLY_QUESTIONS.length);
  });
});
