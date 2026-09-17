import type { CalendarEvent } from './types';

/** Height of one hour in the day timeline. */
export const DAY_HOUR_HEIGHT = 64;
/** An event never renders shorter than this, so a 15 minute plan is readable. */
export const DAY_MIN_EVENT_HEIGHT = 44;
/** The hour label column. */
export const DAY_GUTTER_WIDTH = 56;
/** Pixels of gap between two events that run at the same time. */
export const DAY_EVENT_GAP = 4;

export const MINUTES_IN_DAY = 24 * 60;

export type LaidOutEvent = {
  event: CalendarEvent;
  /** Minutes from midnight, clamped into the day. */
  startMinutes: number;
  endMinutes: number;
  /** Which column it takes when events overlap. */
  column: number;
  /** How many columns its overlap cluster is split into. */
  columnCount: number;
};

/** Minutes from midnight, or null when the value is not a usable date. */
export function minutesFromMidnight(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getHours() * 60 + date.getMinutes();
}

/** The hour the timeline should open on: an hour before the first plan. */
export function initialScrollHour(events: CalendarEvent[]): number {
  const starts = events
    .filter((event) => !event.allDay)
    .map((event) => minutesFromMidnight(event.startsAt))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (starts.length === 0) {
    return 7;
  }
  return Math.min(22, Math.max(0, Math.floor(starts[0] / 60) - 1));
}

type Span = {
  event: CalendarEvent;
  start: number;
  end: number;
};

/**
 * Places a day's timed events: minutes from midnight plus the column each one
 * takes, so two plans at the same time sit side by side rather than on top of
 * each other. All-day events are the caller's business, not this function's.
 */
export function layoutDayEvents(events: CalendarEvent[]): LaidOutEvent[] {
  const spans: Span[] = [];
  for (const event of events) {
    if (event.allDay) {
      continue;
    }
    const rawStart = minutesFromMidnight(event.startsAt);
    const rawEnd = minutesFromMidnight(event.endsAt);
    if (rawStart === null) {
      continue;
    }
    const start = Math.max(0, Math.min(MINUTES_IN_DAY, rawStart));
    // An event that ends at or before it starts still needs a body to draw.
    const end = rawEnd === null ? start + 30 : Math.min(MINUTES_IN_DAY, Math.max(rawEnd, start + 30));
    spans.push({ end, event, start });
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  const laidOut: LaidOutEvent[] = [];
  let cluster: Span[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) {
      return;
    }
    const columnEnds: number[] = [];
    const placed: { span: Span; column: number }[] = [];
    for (const span of cluster) {
      let column = columnEnds.findIndex((end) => end <= span.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(span.end);
      } else {
        columnEnds[column] = span.end;
      }
      placed.push({ column, span });
    }
    const columnCount = Math.max(1, columnEnds.length);
    for (const item of placed) {
      laidOut.push({
        column: item.column,
        columnCount,
        endMinutes: item.span.end,
        event: item.span.event,
        startMinutes: item.span.start,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const span of spans) {
    if (cluster.length > 0 && span.start >= clusterEnd) {
      flush();
    }
    cluster.push(span);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  flush();

  return laidOut;
}
