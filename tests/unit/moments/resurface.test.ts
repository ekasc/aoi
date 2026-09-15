import { describe, expect, test } from 'vitest';

import { findResurfaces, formatResurfaceLabel } from '@/features/moments/resurface';
import type { Moment } from '@/features/moments/types';

function makeMoment(id: string, occurredAt: string): Moment {
  return {
    id,
    type: 'note',
    title: `Moment ${id}`,
    body: '',
    occurredAt,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
  };
}

const NOW = new Date('2026-08-03T12:00:00.000Z');

describe('findResurfaces', () => {
  test('returns moments from the same month/day in earlier years', () => {
    const moments = [
      makeMoment('m1', '2025-08-03T09:00:00.000Z'),
      makeMoment('m2', '2024-08-03T09:00:00.000Z'),
    ];

    const resurfaces = findResurfaces(moments, NOW);

    expect(resurfaces).toHaveLength(2);
    expect(resurfaces[0].moment.id).toBe('m1');
    expect(resurfaces[0].yearsAgo).toBe(1);
    expect(resurfaces[1].moment.id).toBe('m2');
    expect(resurfaces[1].yearsAgo).toBe(2);
  });

  test('ignores moments from this year', () => {
    const moments = [makeMoment('recent', '2026-08-03T08:00:00.000Z')];

    expect(findResurfaces(moments, NOW)).toHaveLength(0);
  });

  test('ignores moments on other days', () => {
    const moments = [
      makeMoment('other-day', '2025-08-04T09:00:00.000Z'),
      makeMoment('other-month', '2025-09-03T09:00:00.000Z'),
    ];

    expect(findResurfaces(moments, NOW)).toHaveLength(0);
  });

  test('skips invalid dates', () => {
    const moments = [makeMoment('broken', 'not-a-date')];

    expect(findResurfaces(moments, NOW)).toHaveLength(0);
  });

  test('caps at three resurfaces, closest year first', () => {
    const moments = [
      makeMoment('y4', '2022-08-03T09:00:00.000Z'),
      makeMoment('y1', '2025-08-03T09:00:00.000Z'),
      makeMoment('y3', '2023-08-03T09:00:00.000Z'),
      makeMoment('y2', '2024-08-03T09:00:00.000Z'),
    ];

    const resurfaces = findResurfaces(moments, NOW);

    expect(resurfaces.map((r) => r.moment.id)).toEqual(['y1', 'y2', 'y3']);
  });

  test('excludes goal-typed moments (Plans content never resurfaces)', () => {
    const moments = [
      { ...makeMoment('goal-1', '2025-08-03T09:00:00.000Z'), type: 'goal' as const },
      makeMoment('note-1', '2025-08-03T09:00:00.000Z'),
    ];

    const resurfaces = findResurfaces(moments, NOW);

    expect(resurfaces.map((r) => r.moment.id)).toEqual(['note-1']);
  });

  test('is deterministic for the same eligible dataset', () => {
    const moments = [
      makeMoment('b', '2024-08-03T09:00:00.000Z'),
      makeMoment('a', '2025-08-03T09:00:00.000Z'),
      makeMoment('c', '2023-08-03T09:00:00.000Z'),
    ];

    const first = findResurfaces(moments, NOW).map((r) => r.moment.id);
    const second = findResurfaces([...moments].reverse(), NOW).map((r) => r.moment.id);

    expect(first).toEqual(second);
    expect(first).toEqual(['a', 'b', 'c']);
  });
});

describe('formatResurfaceLabel', () => {
  test('singular form for one year', () => {
    expect(formatResurfaceLabel(1)).toBe('One year ago today');
  });

  test('plural form for multiple years', () => {
    expect(formatResurfaceLabel(3)).toBe('3 years ago today');
  });
});
