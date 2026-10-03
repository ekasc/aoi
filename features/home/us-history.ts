import { parseRelationshipStart } from '@/features/calendar/calendar-date-utils';
import type { CalendarEvent } from '@/features/calendar/types';
import { describeChapter, filterChapterRange } from '@/features/moments/chapters';
import { findResurfaces } from '@/features/moments/resurface';
import { sortFeedOldestFirst } from '@/features/moments/story-feed';
import type { Moment } from '@/features/moments/types';
import { getDaysTogether } from '@/features/time-together/time-together';

/** Occurrence time is the historical sky's clock, never upload time. */
export function relationshipSky(moments: Moment[], startDate: string | null, asOf: Date) {
  return {
    daysTogether: getDaysTogether(startDate, asOf),
    moments: sortFeedOldestFirst(moments).filter((moment) => new Date(moment.occurredAt).getTime() <= asOf.getTime()),
  };
}

export function usHistory(moments: Moment[], startDate: string | null, now: Date) {
  const sky = relationshipSky(moments, startDate, now);
  const recent = [...sky.moments].reverse().find((moment) => now.getTime() - new Date(moment.occurredAt).getTime() <= 7 * 86400000) ?? null;
  const start = startDate ? parseRelationshipStart(startDate) : null;
  const chapters: { id: string; title: string; memoryIds: string[] }[] = [];
  if (start) {
    for (let year = now.getFullYear() - start.getFullYear(); year >= 1 && chapters.length < 3; year -= 1) {
      const id = `anniversary:${year}:${start.getFullYear() + year}`;
      const chapter = describeChapter(id, startDate);
      if (!chapter || chapter.range.toMs > now.getTime()) continue;
      const members = filterChapterRange(sky.moments, chapter.range.fromMs, chapter.range.toMs);
      if (members.length >= 2) chapters.push({ id, title: chapter.title, memoryIds: members.map((moment) => moment.id) });
    }
  }
  return { ...sky, story: sortFeedOldestFirst(moments), recent, resurface: findResurfaces(sky.moments, now)[0] ?? null, chapters };
}

export function nextTogetherPlan(events: CalendarEvent[], now: Date): CalendarEvent | null {
  return events.filter((event) => event.together && new Date(event.endsAt).getTime() > now.getTime())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id))[0] ?? null;
}

/** A bounded illustration of chronological members, not a similarity graph. */
export function constellationPoints(memoryIds: string[]) {
  return memoryIds.slice(0, 5).map((id, index) => {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return { x: 12 + index * 18, y: 12 + hash % 25 };
  });
}
