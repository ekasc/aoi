import { parseRelationshipStart } from '@/features/calendar/calendar-date-utils';

/**
 * The relationship start as a reader sees it. A date-only start is a calendar
 * day the couple chose, not an instant: parsing it as UTC midnight put it on
 * the previous day for everyone west of UTC. `parseRelationshipStart` keeps a
 * date-only value on its own day and still accepts a full timestamp, whose
 * instant has always been what the account screen showed.
 */
export function formatRelationshipDate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const date = parseRelationshipStart(value);
  if (!date) {
    return null;
  }

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
