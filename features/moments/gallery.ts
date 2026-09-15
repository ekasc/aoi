import { groupFeedByMonth, sortFeedOldestFirst } from '@/features/moments/story-feed';
import type { Moment, MomentAuthorRole } from '@/features/moments/types';

/**
 * Pure Gallery extraction (no hooks, no native deps).
 *
 * The Gallery is the archive as a GRID: the same oldest-first feed, one
 * square tile per real piece of media, months oldest first and media oldest
 * first inside each month. Photos, videos and voice notes all become tiles
 * of the same size, so the wall reads at a glance the way a camera roll
 * does. Nothing here explains a memory — no bylines, no titles, no captions:
 * that is the Feed's job, and a second presentation that repeats it would
 * just be the Feed again.
 *
 * Ordered attachments win wholesale: the attachment contract is image/audio
 * only, and the legacy single-media fields are derived from the first
 * attachment server-side, so reading both would tile that piece twice. The
 * dev-preview video slot (production has no video path yet) is read only
 * when there are no attachments, with the moment's photo as its poster.
 */

/** Tiles per dense grid row. */
export const GALLERY_COLUMNS = 3;

export type GalleryItemKind = 'photo' | 'video' | 'voice';

/** One piece of media on the wall. */
export type GalleryItem = {
  /** Stable key: `momentId:mediaId`, `momentId:legacy`, `momentId:video`, `momentId:audio`. */
  key: string;
  kind: GalleryItemKind;
  /** Owning memory id — the parent context for the full-screen viewer. */
  momentId: string;
  /** Media object id, or null for a legacy single-media moment. */
  mediaId: string | null;
  /** Display URI: image display URL, video source, or audio source. */
  uri: string;
  /** Video still, until the clip is asked to play. Null for photo and voice. */
  posterUri: string | null;
  /** The memory's own title, when it has one. Labels and bylines use it. */
  title: string;
  occurredAt: string;
  authorRole: MomentAuthorRole;
  authorName: string;
};

/** A `GalleryItem` that is known to be a photo. */
export type GalleryPhoto = GalleryItem & { kind: 'photo' };

export function isGalleryPhoto(item: GalleryItem): item is GalleryPhoto {
  return item.kind === 'photo';
}

/**
 * Every real piece of media on a memory, in order. Ordered attachments win
 * wholesale; the dev-preview video slot takes the media slot when there are
 * none (its poster is the moment's photo); the legacy photo and voice fields
 * are read only for memories with no attachments, so nothing appears twice.
 */
export function galleryItemsOf(moment: Moment): GalleryItem[] {
  const base = {
    momentId: moment.id,
    title: moment.title,
    occurredAt: moment.occurredAt,
    authorRole: moment.authorRole,
    authorName: moment.authorName,
  };
  const attachments = moment.attachments ?? [];
  if (attachments.length > 0) {
    return attachments.map((attachment) => ({
      ...base,
      key: `${moment.id}:${attachment.mediaId}`,
      kind: attachment.kind === 'audio' ? ('voice' as const) : ('photo' as const),
      mediaId: attachment.mediaId,
      uri: attachment.url,
      posterUri: null,
    }));
  }
  const items: GalleryItem[] = [];
  if (moment.videoUri) {
    items.push({
      ...base,
      key: `${moment.id}:video`,
      kind: 'video',
      mediaId: moment.mediaId ?? null,
      uri: moment.videoUri,
      posterUri: moment.mediaPreview ?? null,
    });
  } else if (moment.mediaPreview) {
    items.push({
      ...base,
      key: `${moment.id}:legacy`,
      kind: 'photo',
      mediaId: moment.mediaId ?? null,
      uri: moment.mediaPreview,
      posterUri: null,
    });
  }
  if (moment.audioUri) {
    items.push({
      ...base,
      key: `${moment.id}:audio`,
      kind: 'voice',
      mediaId: null,
      uri: moment.audioUri,
      posterUri: null,
    });
  }
  return items;
}

/**
 * Just the photos on a memory, in the same order and under the same keys as
 * `galleryItemsOf`. The full-screen viewer is a photo surface, so it pages
 * through this list while the wall shows everything.
 */
export function galleryPhotosOf(moment: Moment): GalleryPhoto[] {
  return galleryItemsOf(moment).filter(isGalleryPhoto);
}

/**
 * What a tile's play control announces: the memory's own title when it has
 * one, otherwise where the media sits ("2 of 5 from September 2026"). Never
 * just "video".
 */
export function galleryTileLabel(item: GalleryItem, context: string): string {
  return item.title ? `${item.title} (${context})` : context;
}

export type GalleryCounts = {
  photo: number;
  video: number;
  voice: number;
};

/** Media totals for one month, or for any item list. */
export function countGalleryItems(items: GalleryItem[]): GalleryCounts {
  const counts: GalleryCounts = { photo: 0, video: 0, voice: 0 };
  for (const item of items) {
    counts[item.kind] += 1;
  }
  return counts;
}

export type GallerySection = {
  /** Stable section id: `month:YYYY-MM` (matches the chapter route id). */
  id: string;
  monthKey: string;
  label: string;
  items: GalleryItem[];
  counts: GalleryCounts;
};

/**
 * Group a feed list into month sections of media, oldest month first.
 * Months that hold no media (notes, goals) are dropped rather than shown
 * empty; the undated section keeps its place at the end.
 */
export function buildGallerySections(moments: Moment[]): GallerySection[] {
  const sections: GallerySection[] = [];
  for (const section of groupFeedByMonth(sortFeedOldestFirst(moments))) {
    const items = section.moments.flatMap(galleryItemsOf);
    if (items.length === 0) {
      continue;
    }
    sections.push({
      id: section.id,
      monthKey: section.monthKey,
      label: section.label,
      items,
      counts: countGalleryItems(items),
    });
  }
  return sections;
}

/** Full-width month heading row: the grid's divider for one month. */
export type GalleryMonthRow = {
  kind: 'month';
  key: string;
  section: GallerySection;
};

/** One dense grid row of up to `GALLERY_COLUMNS` tiles, of any kind. */
export type GalleryGridRow = {
  kind: 'grid';
  key: string;
  items: GalleryItem[];
  sectionLabel: string;
  /** Where this row starts within the month (tile labels count it). */
  itemStartIndex: number;
  /** Tiles in the whole month, so a tile can say "3 of 12". */
  itemTotal: number;
};

export type GalleryRow = GalleryMonthRow | GalleryGridRow;

export function buildGalleryRows(sections: GallerySection[]): GalleryRow[] {
  const rows: GalleryRow[] = [];
  for (const section of sections) {
    rows.push({ kind: 'month', key: `month:${section.monthKey}`, section });
    // Every kind tiles the same way: one dense row of GALLERY_COLUMNS,
    // partition only, so a video or a voice note never breaks the grid.
    for (let index = 0; index < section.items.length; index += GALLERY_COLUMNS) {
      rows.push({
        kind: 'grid',
        key: `grid:${section.monthKey}:${index}`,
        items: section.items.slice(index, index + GALLERY_COLUMNS),
        sectionLabel: section.label,
        itemStartIndex: index,
        itemTotal: section.items.length,
      });
    }
  }
  return rows;
}
