import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The feed's read position: the newest moment the reader has plausibly seen,
 * as an ISO timestamp. Unread means partner-authored and newer than this —
 * the reader's own posts were seen at the keyboard. The screen draws a "New"
 * boundary above the first unread post from this cursor; the cursor itself
 * only decides where a fresh screen lands.
 */

const SEEN_KEY_PREFIX = 'aoi.feed.seen.v1.';

export function seenKey(spaceId: string | null | undefined): string {
  return `${SEEN_KEY_PREFIX}${spaceId ?? 'default'}`;
}

function normalizeCursor(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export async function loadSeenCursor(
  spaceId: string | null | undefined,
): Promise<string | null> {
  const raw = await AsyncStorage.getItem(seenKey(spaceId)).catch(() => null);
  return normalizeCursor(raw);
}

export async function saveSeenCursor(
  spaceId: string | null | undefined,
  iso: string,
): Promise<void> {
  await AsyncStorage.setItem(seenKey(spaceId), iso).catch(() => undefined);
}

export type SeenMoment = {
  id: string;
  occurredAt: string;
  authorRole: 'you' | 'partner';
};

function occurredAtMs(moment: SeenMoment): number {
  const time = new Date(moment.occurredAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** The archive's newest moment, or null for an empty or undated archive. */
export function newestOccurredAt(moments: SeenMoment[]): string | null {
  let newest: SeenMoment | null = null;
  for (const moment of moments) {
    if (occurredAtMs(moment) <= 0) {
      continue;
    }
    if (!newest || occurredAtMs(moment) > occurredAtMs(newest)) {
      newest = moment;
    }
  }
  return newest ? new Date(occurredAtMs(newest)).toISOString() : null;
}

/**
 * Partner-authored moments newer than the cursor, oldest first. A null
 * cursor means first run, which seeds caught-up rather than calling the
 * whole archive unread — so it answers empty here, and the caller seeds.
 */
export function unreadPartnerMoments(
  moments: SeenMoment[],
  cursorIso: string | null,
): SeenMoment[] {
  if (!cursorIso) {
    return [];
  }
  const cursor = new Date(cursorIso).getTime();
  if (Number.isNaN(cursor)) {
    return [];
  }
  return moments
    .filter((moment) => moment.authorRole === 'partner' && occurredAtMs(moment) > cursor)
    .sort((a, b) => occurredAtMs(a) - occurredAtMs(b));
}

/** Oldest unread partner moment id, or null when caught up. */
export function firstUnreadPartnerId(
  moments: SeenMoment[],
  cursorIso: string | null,
): string | null {
  const unread = unreadPartnerMoments(moments, cursorIso);
  return unread.length > 0 ? unread[0].id : null;
}

type FeedRowLike = { kind: string; moment?: { id: string } };

/** Row index of a moment in feed rows, or -1 when it is not on screen. */
export function feedRowIndexForMomentId(
  rows: FeedRowLike[],
  momentId: string,
): number {
  return rows.findIndex((row) => row.kind === 'moment' && row.moment?.id === momentId);
}

type GalleryRowLike = { kind: string; items?: { momentId: string }[] };

/** Row index of the grid row holding a moment, or -1 when it is not shown. */
export function galleryRowIndexForMomentId(
  rows: GalleryRowLike[],
  momentId: string,
): number {
  return rows.findIndex(
    (row) => row.kind === 'grid' && (row.items ?? []).some((item) => item.momentId === momentId),
  );
}

type ScrollableList = {
  scrollToIndex?: (options: { animated: boolean; index: number; viewPosition: number }) => void;
  scrollToEnd?: (options: { animated: boolean }) => void;
} | null
  | undefined;

/**
 * Puts a row near the top of the viewport so what follows it fills the
 * screen below. Falls back to the end when the row cannot be placed (an
 * unmeasured list throws): a wrong-but-close landing is never attempted.
 */
export function scrollListToIndexOrEnd(list: ScrollableList, index: number): void {
  if (index >= 0) {
    try {
      list?.scrollToIndex?.({ animated: false, index, viewPosition: 0.2 });
      return;
    } catch {
      // Unmeasured: fall through to the end below.
    }
  }
  try {
    list?.scrollToEnd?.({ animated: false });
  } catch {
    // A list that cannot scroll keeps its opening frame; nothing about the
    // session depends on landing.
  }
}
