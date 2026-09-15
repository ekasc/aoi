/**
 * Human-readable moment labels, in one place.
 *
 * The feed, the card, the composer's pending row, and month headings all
 * print dates and times; they must agree on the locale and the format, so
 * the locale lives here rather than being repeated per file.
 */

/** One locale for every human-readable moment label. */
export const MOMENT_LOCALE = 'en-US';

function parseMomentDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Full date, e.g. `Mar 15, 2026`. Falls back when the date is unreadable,
 * so a caller can say "Date TBD" where the field is required.
 */
export function formatMomentDate(value: string, fallback = ''): string {
  const date = parseMomentDate(value);
  if (!date) {
    return fallback;
  }
  return date.toLocaleDateString(MOMENT_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Clock time, e.g. `3:42 PM`. Empty when the date is unreadable. */
export function formatMomentTime(value: string): string {
  const date = parseMomentDate(value);
  if (!date) {
    return '';
  }
  return date.toLocaleTimeString(MOMENT_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Day and month, e.g. `Mar 15`. Empty when the date is unreadable. */
export function formatMomentShortDate(value: string): string {
  const date = parseMomentDate(value);
  if (!date) {
    return '';
  }
  return date.toLocaleDateString(MOMENT_LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

/** `12 photos` / `1 photo`. */
function pluralCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * What one album month holds, e.g. `12 photos · 1 video · 2 voice notes`.
 * Zero kinds are dropped rather than printed as "0 videos", and an empty
 * month reads empty instead of "· —".
 */
export function formatGalleryCounts(counts: {
  photo: number;
  video: number;
  voice: number;
}): string {
  const parts: string[] = [];
  if (counts.photo > 0) {
    parts.push(pluralCount(counts.photo, 'photo'));
  }
  if (counts.video > 0) {
    parts.push(pluralCount(counts.video, 'video'));
  }
  if (counts.voice > 0) {
    parts.push(pluralCount(counts.voice, 'voice note'));
  }
  return parts.join(' · ');
}
