import { groupFeedByMonth, sortFeedOldestFirst } from '@/features/moments/story-feed';
import type { Moment } from '@/features/moments/types';

// Pure Gallery extraction (no hooks, no native deps). The Gallery is a
// second presentation of the same oldest-first feed: one dense tile per
// real photo, months oldest first, photos oldest first inside each month.
// The data model only carries image/audio
// attachments — video never appears here — and the legacy single-photo
// field is read only when a moment has no ordered attachments, so a photo
// never tiles twice.

/** Tiles per dense grid row. */
export const GALLERY_COLUMNS = 3;

/** One photo tile. `momentId` keeps the parent memory in reach. */
export type GalleryPhoto = {
  /** Stable tile key: `momentId:mediaId` (or `momentId:legacy`). */
  key: string;
  /** Owning memory id — the parent context for the full-screen viewer. */
  momentId: string;
  /** Media object id, or null for a legacy single-photo moment. */
  mediaId: string | null;
  /** Raw display URI; the render boundary resolves staged paths. */
  uri: string;
};

/**
 * Every real photo on a memory, in server order. Ordered attachments win
 * wholesale: the legacy `mediaPreview` is derived from the first attachment
 * server-side, so reading it too would duplicate that photo. Audio
 * attachments are not photos and are dropped.
 */
export function galleryPhotosOf(moment: Moment): GalleryPhoto[] {
  const attachments = moment.attachments ?? [];
  if (attachments.length > 0) {
    const photos: GalleryPhoto[] = [];
    for (const attachment of attachments) {
      if (attachment.kind !== 'image') {
        continue;
      }
      photos.push({
        key: `${moment.id}:${attachment.mediaId}`,
        momentId: moment.id,
        mediaId: attachment.mediaId,
        uri: attachment.url,
      });
    }
    return photos;
  }
  if (moment.mediaPreview) {
    return [
      {
        key: `${moment.id}:legacy`,
        momentId: moment.id,
        mediaId: moment.mediaId ?? null,
        uri: moment.mediaPreview,
      },
    ];
  }
  return [];
}

export type GalleryMonthSection = {
  /** Stable section id: `month:YYYY-MM` (matches the chapter route id). */
  id: string;
  monthKey: string;
  label: string;
  photos: GalleryPhoto[];
};

/**
 * Group a feed list into month sections of photos, oldest month first.
 * Months that hold no photos (notes, voice, goals) are
 * dropped rather than shown empty.
 */
export function buildGallerySections(moments: Moment[]): GalleryMonthSection[] {
  const sections: GalleryMonthSection[] = [];
  for (const section of groupFeedByMonth(sortFeedOldestFirst(moments))) {
    const photos = section.moments.flatMap(galleryPhotosOf);
    if (photos.length === 0) {
      continue;
    }
    sections.push({
      id: section.id,
      monthKey: section.monthKey,
      label: section.label,
      photos,
    });
  }
  return sections;
}

/** Full-width month heading row. */
export type GalleryMonthRow = {
  kind: 'month';
  key: string;
  label: string;
};

/** One dense grid row of up to `GALLERY_COLUMNS` tiles. */
export type GalleryGridRow = {
  kind: 'grid';
  key: string;
  photos: GalleryPhoto[];
  sectionLabel: string;
  /** Index of the first photo within its month section (for labels). */
  startIndex: number;
};

export type GalleryRow = GalleryMonthRow | GalleryGridRow;

/**
 * Flatten sections into FlatList rows: a month heading, then its photos
 * chunked into dense `GALLERY_COLUMNS`-wide rows. Virtualization stays at
 * row granularity while headings keep full width.
 */
export function buildGalleryRows(sections: GalleryMonthSection[]): GalleryRow[] {
  const rows: GalleryRow[] = [];
  for (const section of sections) {
    rows.push({ kind: 'month', key: `month:${section.monthKey}`, label: section.label });
    for (
      let startIndex = 0;
      startIndex < section.photos.length;
      startIndex += GALLERY_COLUMNS
    ) {
      rows.push({
        kind: 'grid',
        key: `grid:${section.monthKey}:${startIndex}`,
        photos: section.photos.slice(startIndex, startIndex + GALLERY_COLUMNS),
        sectionLabel: section.label,
        startIndex,
      });
    }
  }
  return rows;
}
