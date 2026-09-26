import { daysInMonth } from '@/features/calendar/calendar-date-utils';

/** The first year is the useful product boundary for relationship-aware copy. */
export const RELATIONSHIP_AGE_THRESHOLD_MONTHS = 12;

export type RelationshipTone = 'neutral' | 'discovery' | 'established';

export type RelationshipAge = {
  tone: RelationshipTone;
  monthsTogether: number | null;
};

/** Parse a date without allowing JavaScript to roll 2024-02-31 into March. */
function parseStartDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) return null;
    const parsed = new Date(0);
    parsed.setHours(0, 0, 0, 0);
    parsed.setFullYear(year, month - 1, day);
    return parsed;
  }
  const timestamp = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!timestamp) return null;
  const year = Number(timestamp[1]);
  const month = Number(timestamp[2]);
  const day = Number(timestamp[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar months completed; missing, malformed, and future dates stay neutral. */
export function getRelationshipAge(
  relationshipStartDate: string | null | undefined,
  now: Date = new Date(),
): RelationshipAge {
  const start = parseStartDate(relationshipStartDate);
  if (!start || Number.isNaN(now.getTime())) return { tone: 'neutral', monthsTogether: null };

  const dayDelta = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  if (dayDelta < 0) return { tone: 'neutral', monthsTogether: null };

  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  const anniversaryDay = Math.min(start.getDate(), daysInMonth(now.getFullYear(), now.getMonth()));
  if (now.getDate() < anniversaryDay) months -= 1;
  const tone = months < RELATIONSHIP_AGE_THRESHOLD_MONTHS ? 'discovery' : 'established';
  return { tone, monthsTogether: Math.max(0, months) };
}

export type RelationshipCopy = {
  memoryTitle: string;
  memoryBody: string;
  memoryButton: string;
  planEmpty: string;
  letterIntro: string;
  letterPlaceholder: string;
  reflectionIntro: string;
};

export function relationshipCopy(tone: RelationshipTone): RelationshipCopy {
  if (tone === 'discovery') {
    return {
      memoryTitle: 'Keep your first little things',
      memoryBody: 'A photo, a few lines, or a short recording can hold onto what you are discovering together.',
      memoryButton: 'Keep something from today',
      planEmpty: 'Make room for something new to try together.',
      letterIntro: 'Write something they can discover about you on a future day.',
      letterPlaceholder: "Write it as if they'll read it on that day…",
      reflectionIntro: 'One question this week, answer whenever you like. A small way to learn each other.',
    };
  }
  if (tone === 'established') {
    return {
      memoryTitle: 'Keep what feels like you',
      memoryBody: 'Bring in a favorite memory or keep something from today. Your story can start wherever you are.',
      memoryButton: 'Keep something from today',
      planEmpty: 'Make room to appreciate each other or revisit something you love.',
      letterIntro: 'Write something they will be glad to find on a future day.',
      letterPlaceholder: "Write what you want to remember about this season together…",
      reflectionIntro: 'One question this week, answer whenever you like. A small way to notice each other.',
    };
  }
  return {
    memoryTitle: 'Your first memory',
    memoryBody: 'A photo, a few lines, or a short recording, kept just for the two of you.',
    memoryButton: 'Keep your first memory',
    planEmpty: 'Make room for something you would like to do together.',
    letterIntro: 'Write it now; they’ll open it on the day you choose.',
    letterPlaceholder: "Write it as if they'll read it on that day…",
    reflectionIntro: 'One question this week, answer whenever you like.',
  };
}
