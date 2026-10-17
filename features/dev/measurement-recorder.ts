/**
 * Dev-only diagnostic recorder for the feed's paging and scrolling work.
 *
 * Two rules shape it. Nothing is serialized while an interaction is being
 * measured, so repeated events accumulate into counters rather than pushing an
 * object each time. And every timestamp comes from one clock, the device's own
 * monotonic `performance.now()`, so spans and marks on the device are directly
 * comparable while anything measured on the host stays on the host clock.
 *
 * It is a diagnostic, not an observability system: a bounded in-memory buffer,
 * one export, and no dependencies.
 */

export type RecorderEventKind =
  | 'mark'
  | 'span'
  | 'window'
  | 'react'
  | 'request';

export type RecorderEvent = {
  /** Milliseconds since the recorder started, on the device clock. */
  t: number;
  kind: RecorderEventKind;
  name: string;
  /** Duration in milliseconds, where the event has one. */
  durMs?: number;
  counts?: Record<string, number>;
  data?: Record<string, string | number | boolean | null>;
};

const MAX_EVENTS = 20000;

type RecorderState = {
  events: RecorderEvent[];
  dropped: number;
  startedAt: number;
  recording: boolean;
  window: { label: string; startedAt: number; counts: Record<string, number> } | null;
};

let state: RecorderState | null = null;

/** When anything was last recorded, so a settle can be defined by quiet. */
let lastActivityAt = 0;
/** When page-owned work was last recorded. Background ticks do not move this. */
let lastPageActivityAt = 0;
/** What that last activity was, so a settle can name what kept it alive. */
let lastPageLabel = '';
let lastAllLabel = '';

function touchAll(label?: string): void {
  lastActivityAt = performance.now();
  if (label) {
    lastAllLabel = label;
  }
}

function touchPage(label?: string): void {
  lastPageActivityAt = lastActivityAt = performance.now();
  if (label) {
    lastPageLabel = label;
  }
}

/**
 * Wait until nothing relevant has been recorded for `quietMs`, or give up after
 * `maxMs`.
 *
 * `scope: 'page'` watches page-owned work only (requests, merge, derivation,
 * card renders, media callbacks). `scope: 'all'` watches everything, including
 * background subscriptions such as the idle voice-note clock. Recording both is
 * the point: a page can be usable long before the whole application goes quiet.
 */
export async function awaitQuiet(options: {
  quietMs: number;
  maxMs: number;
  scope?: 'page' | 'all';
}): Promise<{ settled: boolean; waitedMs: number }> {
  const scope = options.scope ?? 'all';
  const startedAt = performance.now();
  if (!state?.recording) {
    return { settled: true, waitedMs: 0 };
  }
  if (scope === 'page') {
    touchPage();
  } else {
    touchAll();
  }
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = performance.now();
    const since = now - (scope === 'page' ? lastPageActivityAt : lastActivityAt);
    if (since >= options.quietMs) {
      return { settled: true, waitedMs: now - startedAt };
    }
    if (now - startedAt >= options.maxMs) {
      return { settled: false, waitedMs: now - startedAt };
    }
  }
}

/** Bounded detail for the media timeline; counters carry the bulk. */
const MAX_MEDIA_EVENTS = 600;
const mediaEvents: RecorderEvent[] = [];
let mediaDropped = 0;

/**
 * One entry in the media timeline, from a native image callback or the backend.
 * Counters in the open window carry the totals; this carries the detail, and it
 * is capped so a long run cannot grow without bound.
 */
export function recordMedia(
  phase: string,
  data: Record<string, string | number | boolean | null>
): void {
  if (!state?.recording) {
    return;
  }
  touchPage(`media.${phase}`);
  if (mediaEvents.length >= MAX_MEDIA_EVENTS) {
    mediaDropped += 1;
    return;
  }
  mediaEvents.push({
    data,
    kind: 'mark',
    name: `media.${phase}`,
    t: Math.round((performance.now() - (state?.startedAt ?? 0)) * 100) / 100,
  });
}

/**
 * Ids of cards that have rendered at least once. Kept across windows so a card
 * that first appeared on an earlier page is counted as a re-render later.
 */
const renderedCards = new Set<string>();

/**
 * Count one card render. A card seen before is a re-render; a card seen for the
 * first time is a first render. "Rendered" rather than "mounted" on purpose:
 * this runs during render, so it sees render attempts, not commitments.
 */
export function noteCardRender(id: string): void {
  if (!state?.window) {
    return;
  }
  if (renderedCards.has(id)) {
    bump('cardReRender');
    return;
  }
  renderedCards.add(id);
  bump('cardFirstRender');
}

/** The device clock the recorder writes against. */
export function recorderNow(): number {
  return performance.now();
}

export function isRecording(): boolean {
  return state?.recording === true;
}

/**
 * Counters that work with or without an open window, for asserting that a
 * stretch of work did or did not happen at all.
 */
const totals: Record<string, number> = {};

export function incrementTotals(key: string, by = 1): void {
  if (!state?.recording) {
    return;
  }
  totals[key] = (totals[key] ?? 0) + by;
}

export function readTotals(): Record<string, number> {
  return { ...totals };
}

export function startRecorder(): { startedAt: number } {
  renderedCards.clear();
  mediaEvents.length = 0;
  mediaDropped = 0;
  lastActivityAt = performance.now();
  lastPageActivityAt = lastActivityAt;
  lastPageLabel = '';
  lastAllLabel = '';
  for (const key of Object.keys(totals)) {
    delete totals[key];
  }
  state = {
    dropped: 0,
    events: [],
    recording: true,
    startedAt: performance.now(),
    window: null,
  };
  return { startedAt: state.startedAt };
}

export function stopRecorder(): void {
  if (state) {
    state.recording = false;
  }
}

export function clearRecorder(): void {
  renderedCards.clear();
  for (const key of Object.keys(totals)) {
    delete totals[key];
  }
  state = null;
}

function push(event: Omit<RecorderEvent, 't'>, options?: { background?: boolean }): void {
  if (!state?.recording) {
    return;
  }
  if (options?.background) {
    touchAll(event.name);
  } else {
    touchPage(event.name);
  }
  if (state.events.length >= MAX_EVENTS) {
    state.dropped += 1;
    return;
  }
  state.events.push({
    ...event,
    t: Math.round((performance.now() - state.startedAt) * 100) / 100,
  });
}

/** A point in time, for correlating a phase with the host's own actions. */
export function mark(name: string, data?: RecorderEvent['data']): void {
  push({ kind: 'mark', name, ...(data ? { data } : {}) });
}

/** Close a span that was opened with `recorderNow()`. */
export function recordSpan(
  name: string,
  startedAt: number,
  data?: RecorderEvent['data']
): void {
  const durMs = performance.now() - startedAt;
  push({
    kind: name.startsWith('request') ? 'request' : 'span',
    name,
    durMs: Math.round(durMs * 100) / 100,
    ...(data ? { data } : {}),
  });
}

/**
 * A commit is attributed to React's work but not necessarily to the page: the
 * profiled subtree contains background subscribers. It therefore does not
 * extend a page-scoped settle.
 */
export function recordCommit(
  name: string,
  actualDuration: number,
  phase: string,
  data?: RecorderEvent['data']
): void {
  push(
    {
      kind: 'react',
      name,
      durMs: Math.round(actualDuration * 100) / 100,
      data: { phase, ...(data ?? {}) },
    },
    { background: true }
  );
}

/**
 * Open a labelled window. Counters bumped inside it are folded into a single
 * event when it closes, so a hundred card renders cost a hundred increments and
 * one allocation.
 */
export function beginWindow(label: string): boolean {
  if (!state?.recording) {
    return false;
  }
  state.window = { counts: {}, label, startedAt: performance.now() };
  return true;
}

export function bump(key: string, by = 1): void {
  const window = state?.window;
  if (!window) {
    return;
  }
  touchPage(key);
  window.counts[key] = (window.counts[key] ?? 0) + by;
}

/**
 * Counter for activity that is real but not the page's own, such as the idle
 * voice-note clock. Counted for diagnosis, deliberately not treated as work
 * that keeps a page open.
 */
export function bumpBackground(key: string, by = 1): void {
  const window = state?.window;
  if (!window) {
    return;
  }
  touchAll(key);
  window.counts[key] = (window.counts[key] ?? 0) + by;
}

export function endWindow(
  data?: RecorderEvent['data']
): { label: string; durMs: number; counts: Record<string, number> } | null {
  const window = state?.window;
  if (!state?.recording || !window) {
    return null;
  }
  state.window = null;
  const durMs = performance.now() - window.startedAt;
  push({
    kind: 'window',
    name: window.label,
    durMs: Math.round(durMs * 100) / 100,
    counts: window.counts,
    data: {
      lastAllActivity: lastAllLabel,
      lastPageActivity: lastPageLabel,
      ...(data ?? {}),
    },
  });
  return { counts: window.counts, durMs, label: window.label };
}

export function exportRecorder(): {
  startedAt: number;
  recording: boolean;
  events: RecorderEvent[];
  mediaEvents: RecorderEvent[];
  mediaDropped: number;
  dropped: number;
} | null {
  if (!state) {
    return null;
  }
  return {
    dropped: state.dropped,
    events: state.events,
    mediaDropped,
    mediaEvents: [...mediaEvents],
    recording: state.recording,
    startedAt: state.startedAt,
  };
}
