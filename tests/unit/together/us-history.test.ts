import { describe, expect, it } from 'vitest';

import { constellationPoints, nextTogetherPlan, relationshipSky, usHistory } from '@/features/home/us-history';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Moment } from '@/features/moments/types';

const memory = (id: string, occurredAt: string, type: Moment['type'] = 'note'): Moment => ({ id, occurredAt, type, title: id, body: '', createdAt: occurredAt, authorId: 'you', authorName: 'Maya', authorRole: 'you' });
const now = new Date('2026-09-05T20:00:00');

describe('relationship history selectors', () => {
  it('uses occurrence dates, not upload dates, and keeps day-one semantics for historical skies', () => {
    const moments = [memory('early', '2024-06-01T12:00:00'), memory('later', '2024-06-03T12:00:00')];
    moments[0].createdAt = '2026-01-01T12:00:00';
    const sky = relationshipSky(moments, '2024-06-01', new Date('2024-06-01T20:00:00'));
    expect(sky.daysTogether).toBe(1); expect(sky.moments.map((item) => item.id)).toEqual(['early']);
    expect(relationshipSky([], null, now).daysTogether).toBeNull();
    expect(relationshipSky([], '2027-01-01', now).daysTogether).toBeNull();
  });
  it('excludes goals and future content from current activity and resurfacing', () => {
    const history = usHistory([memory('goal', '2025-09-05', 'goal'), memory('future', '2027-09-05')], '2024-01-01', now);
    expect(history.recent).toBeNull(); expect(history.resurface).toBeNull(); expect(history.moments).toEqual([]);
    expect(history.story.map((moment) => moment.id)).toEqual(['future']);
  });
  it('omits recent activity after seven days and only resurfaces a matching earlier calendar date', () => {
    const history = usHistory([memory('old', '2026-08-01'), memory('different-day', '2025-09-04')], null, now);
    expect(history.recent).toBeNull(); expect(history.resurface).toBeNull();
    expect(usHistory([memory('same-day', '2025-09-05T21:00:00')], null, now).resurface?.moment.id).toBe('same-day');
  });
  it('uses completed explicit relationship-year ranges and never invents monthly or trip groupings', () => {
    const moments = [memory('one', '2024-07-01'), memory('two', '2024-08-01'), memory('current', '2026-08-01'), memory('goal', '2024-09-01', 'goal')];
    expect(usHistory(moments, null, now).chapters).toEqual([]);
    expect(usHistory(moments, '2022-06-01', now).chapters).toEqual([{ id: 'anniversary:3:2025', title: 'Three years together', memoryIds: ['one', 'two'] }]);
    expect(usHistory([moments[0]], '2022-06-01', now).chapters).toEqual([]);
  });
  it('bounds chapter previews to the latest three supported years and illustrations to five points', () => {
    const moments = [2022, 2023, 2024, 2025].flatMap((year) => [memory(`${year}-a`, `${year}-07-01`), memory(`${year}-b`, `${year}-08-01`)]);
    expect(usHistory(moments, '2022-06-01', now).chapters.map((chapter) => chapter.id)).toEqual(['anniversary:4:2026', 'anniversary:3:2025', 'anniversary:2:2024']);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(constellationPoints(ids)).toEqual(constellationPoints(ids));
    expect(constellationPoints(ids)).toHaveLength(5);
    expect(constellationPoints(ids).every((point) => point.x >= 12 && point.x <= 84 && point.y >= 12 && point.y <= 36)).toBe(true);
  });
  it('selects only unexpired together plans, retaining ongoing events', () => {
    const event = (id: string, startsAt: string, endsAt: string, together: boolean): CalendarEvent => ({ id, startsAt, endsAt, together, title: id, actor: 'you', actorName: 'Maya', label: { preset: 'Date' }, createdAt: startsAt, updatedAt: startsAt });
    const ongoing = event('ongoing', '2026-09-05T19:00:00', '2026-09-05T21:00:00', true);
    expect(nextTogetherPlan([event('solo', '2026-09-05T18:00:00', '2026-09-05T22:00:00', false), event('past', '2026-09-04T18:00:00', '2026-09-04T22:00:00', true), ongoing], now)).toEqual(ongoing);
    expect(nextTogetherPlan([], now)).toBeNull();
  });
});
