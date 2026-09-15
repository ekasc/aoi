import type { Moment } from '@/features/moments/types';

/**
 * A moment that resurfaces "on this day" — same month/day as today,
 * at least one year in the past.
 */
export type Resurface = {
  moment: Moment;
  yearsAgo: number;
};

const MAX_RESURFACES = 3;

function isSameMonthAndDay(value: Date, reference: Date): boolean {
  return (
    value.getMonth() === reference.getMonth() &&
    value.getDate() === reference.getDate()
  );
}

/**
 * Find moments worth resurfacing today. Returns at most MAX_RESURFACES
 * entries, closest year first, so the most recent memory leads.
 *
 * Eligibility (P4B): only published memories in the list — same month/day
 * as today, at least one year back. Excluded by construction or by filter:
 * - sealed letters / proposals are not moments, so they never appear here;
 * - deleted moments are dropped from the moments list upstream (tombstones
 *   are separate), so they never appear here;
 * - goal-typed moments are excluded explicitly — future goals and Plans
 *   content must not surface as memories;
 * - anything from the current year (including extremely recent memories)
 *   is excluded by the yearsAgo < 1 guard.
 *
 * Deterministic: same input always yields the same output in the same
 * order, so the card never flickers between renders.
 */
export function findResurfaces(
  moments: Moment[],
  now: Date = new Date()
): Resurface[] {
  const currentYear = now.getFullYear();
  const results: Resurface[] = [];

  for (const moment of moments) {
    // Plans-owned content never resurfaces as a memory.
    if (moment.type === 'goal') {
      continue;
    }

    const occurredAt = new Date(moment.occurredAt);

    if (Number.isNaN(occurredAt.getTime())) {
      continue;
    }

    if (!isSameMonthAndDay(occurredAt, now)) {
      continue;
    }

    const yearsAgo = currentYear - occurredAt.getFullYear();

    if (yearsAgo < 1) {
      continue;
    }

    results.push({ moment, yearsAgo });
  }

  results.sort((left, right) => left.yearsAgo - right.yearsAgo);

  return results.slice(0, MAX_RESURFACES);
}

export function formatResurfaceLabel(yearsAgo: number): string {
  if (yearsAgo === 1) {
    return 'One year ago today';
  }

  return `${yearsAgo} years ago today`;
}
