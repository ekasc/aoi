import { describe, expect, it } from 'vitest';

import {
  buildGalleryRows,
  buildGallerySections,
  countGalleryItems,
  galleryItemsOf,
  galleryPhotosOf,
  isGalleryPhoto,
  GALLERY_COLUMNS,
  type GalleryItem,
  type GalleryPhoto,
  type GallerySection,
} from '@/features/moments/gallery';
import { formatGalleryCounts } from '@/features/moments/labels';
import type { Moment, MomentAttachment } from '@/features/moments/types';

// ── Fixtures ────────────────────────────────────────────────────────────

function makeMoment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm-1',
    type: 'note',
    title: 'Title',
    body: 'Body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'Maya',
    isOwn: true,
    ...overrides,
  };
}

function image(mediaId: string): MomentAttachment {
  return { mediaId, kind: 'image', url: `https://cdn.test/${mediaId}` };
}

function audio(mediaId: string): MomentAttachment {
  return { mediaId, kind: 'audio', url: `https://cdn.test/${mediaId}` };
}

function keys(items: GalleryItem[]): string[] {
  return items.map((item) => item.key);
}

function section(overrides: Partial<GallerySection> & { items: GalleryItem[] }): GallerySection {
  return {
    id: 'month:2026-03',
    monthKey: '2026-03',
    label: 'March 2026',
    counts: countGalleryItems(overrides.items),
    ...overrides,
  };
}

function photoItem(key: string): GalleryPhoto {
  return {
    key,
    kind: 'photo',
    momentId: 'm',
    mediaId: key,
    uri: `https://cdn.test/${key}`,
    posterUri: null,
    title: 'Title',
    occurredAt: '2026-03-15T10:00:00.000Z',
    authorRole: 'you',
    authorName: 'Maya',
  };
}

function voiceItem(key: string): GalleryItem {
  return { ...photoItem(key), kind: 'voice', posterUri: null };
}

// ── galleryItemsOf ──────────────────────────────────────────────────────

describe('galleryItemsOf', () => {
  it('extracts every ordered attachment, in server order, by kind', () => {
    const moment = makeMoment({
      id: 'photo-1',
      title: 'Lake day',
      attachments: [image('a'), audio('v'), image('b')],
    });
    expect(galleryItemsOf(moment)).toEqual([
      {
        key: 'photo-1:a',
        kind: 'photo',
        momentId: 'photo-1',
        mediaId: 'a',
        uri: 'https://cdn.test/a',
        posterUri: null,
        title: 'Lake day',
        occurredAt: '2026-03-15T10:00:00.000Z',
        authorRole: 'you',
        authorName: 'Maya',
      },
      {
        key: 'photo-1:v',
        kind: 'voice',
        momentId: 'photo-1',
        mediaId: 'v',
        uri: 'https://cdn.test/v',
        posterUri: null,
        title: 'Lake day',
        occurredAt: '2026-03-15T10:00:00.000Z',
        authorRole: 'you',
        authorName: 'Maya',
      },
      {
        key: 'photo-1:b',
        kind: 'photo',
        momentId: 'photo-1',
        mediaId: 'b',
        uri: 'https://cdn.test/b',
        posterUri: null,
        title: 'Lake day',
        occurredAt: '2026-03-15T10:00:00.000Z',
        authorRole: 'you',
        authorName: 'Maya',
      },
    ]);
  });

  it('never duplicates a piece of media: attachments win over the legacy fields', () => {
    const moment = makeMoment({
      id: 'both',
      mediaPreview: 'file:///derived.jpg',
      audioUri: 'file:///derived.m4a',
      mediaId: 'media-first',
      attachments: [image('a')],
    });
    expect(keys(galleryItemsOf(moment))).toEqual(['both:a']);
  });

  it('falls back to the legacy single photo when there are no attachments', () => {
    const moment = makeMoment({
      id: 'legacy',
      mediaPreview: 'file:///legacy.jpg',
      mediaId: 'media-legacy',
    });
    expect(galleryItemsOf(moment)).toEqual([
      {
        key: 'legacy:legacy',
        kind: 'photo',
        momentId: 'legacy',
        mediaId: 'media-legacy',
        uri: 'file:///legacy.jpg',
        posterUri: null,
        title: 'Title',
        occurredAt: '2026-03-15T10:00:00.000Z',
        authorRole: 'you',
        authorName: 'Maya',
      },
    ]);
  });

  it('carries the legacy voice note as a voice item, beside the photo', () => {
    const moment = makeMoment({
      id: 'mixed',
      mediaPreview: 'file:///p.jpg',
      audioUri: 'file:///v.m4a',
    });
    expect(keys(galleryItemsOf(moment))).toEqual(['mixed:legacy', 'mixed:audio']);
    expect(galleryItemsOf(moment)[1]).toMatchObject({ kind: 'voice', uri: 'file:///v.m4a' });
  });

  it('reads the dev-preview video as its own item, with the photo as its poster', () => {
    const moment = makeMoment({
      id: 'clip',
      title: 'Beach dog',
      mediaPreview: 'file:///poster.jpg',
      videoUri: 'https://cdn.test/clip.mp4',
      mediaId: 'media-video',
    });
    expect(galleryItemsOf(moment)).toEqual([
      {
        key: 'clip:video',
        kind: 'video',
        momentId: 'clip',
        mediaId: 'media-video',
        uri: 'https://cdn.test/clip.mp4',
        posterUri: 'file:///poster.jpg',
        title: 'Beach dog',
        occurredAt: '2026-03-15T10:00:00.000Z',
        authorRole: 'you',
        authorName: 'Maya',
      },
    ]);
  });

  it('keeps a video without a still, so the tile falls back to a ground', () => {
    const moment = makeMoment({ id: 'bare', videoUri: 'https://cdn.test/clip.mp4' });
    expect(galleryItemsOf(moment)[0]).toMatchObject({ kind: 'video', posterUri: null });
  });

  it('returns nothing for a memory with no media at all', () => {
    expect(galleryItemsOf(makeMoment({ id: 'note' }))).toEqual([]);
  });
});

// ── galleryPhotosOf ─────────────────────────────────────────────────────

describe('galleryPhotosOf', () => {
  it('keeps only photos, under the same keys the wall shows', () => {
    const moment = makeMoment({
      id: 'mixed',
      attachments: [image('i1'), audio('a1'), image('i2')],
    });
    const photos = galleryPhotosOf(moment);
    expect(keys(photos)).toEqual(['mixed:i1', 'mixed:i2']);
    expect(photos.every(isGalleryPhoto)).toBe(true);
  });

  it('drops a video: the full-screen viewer is a photo surface', () => {
    const moment = makeMoment({ id: 'clip', videoUri: 'https://cdn.test/c.mp4' });
    expect(galleryPhotosOf(moment)).toEqual([]);
  });
});

// ── countGalleryItems ───────────────────────────────────────────────────

describe('countGalleryItems', () => {
  it('counts each kind separately', () => {
    expect(
      countGalleryItems([
        photoItem('a'),
        photoItem('b'),
        voiceItem('v'),
        { ...photoItem('c'), kind: 'video', posterUri: 'file:///p.jpg' },
      ]),
    ).toEqual({ photo: 2, video: 1, voice: 1 });
  });

  it('reports an empty wall as zeroes', () => {
    expect(countGalleryItems([])).toEqual({ photo: 0, video: 0, voice: 0 });
  });
});

// ── buildGallerySections ────────────────────────────────────────────────

describe('buildGallerySections', () => {
  it('groups media into oldest-first month sections and drops media-less months', () => {
    const moments: Moment[] = [
      makeMoment({
        id: 'mar-photo',
        attachments: [image('m1'), image('m2')],
        occurredAt: '2026-03-20T10:00:00.000Z',
      }),
      makeMoment({ id: 'mar-note', occurredAt: '2026-03-12T10:00:00.000Z' }),
      makeMoment({
        id: 'feb-photo',
        mediaPreview: 'file:///feb.jpg',
        occurredAt: '2026-02-10T10:00:00.000Z',
      }),
      makeMoment({
        id: 'jan-voice',
        type: 'trace',
        audioUri: 'file:///a.m4a',
        occurredAt: '2026-01-05T10:00:00.000Z',
      }),
    ];

    const sections = buildGallerySections(moments);
    expect(sections.map((entry) => entry.id)).toEqual([
      'month:2026-01',
      'month:2026-02',
      'month:2026-03',
    ]);
    expect(keys(sections[2].items)).toEqual(['mar-photo:m1', 'mar-photo:m2']);
    expect(keys(sections[1].items)).toEqual(['feb-photo:legacy']);
    // A month that holds only a voice note is still a month of the album.
    expect(sections[0].items).toMatchObject([{ kind: 'voice' }]);
    expect(sections.map((entry) => entry.counts)).toEqual([
      { photo: 0, video: 0, voice: 1 },
      { photo: 1, video: 0, voice: 0 },
      { photo: 2, video: 0, voice: 0 },
    ]);
  });

  it('parks undated media in a trailing Undated section', () => {
    const sections = buildGallerySections([
      makeMoment({ id: 'bad', mediaPreview: 'file:///x.jpg', occurredAt: 'not-a-date' }),
      makeMoment({ id: 'good', mediaPreview: 'file:///g.jpg', occurredAt: '2026-03-15T10:00:00.000Z' }),
    ]);
    expect(sections.map((entry) => entry.monthKey)).toEqual(['2026-03', 'undated']);
    expect(sections[1].label).toBe('Undated');
  });
});

// ── buildGalleryRows ────────────────────────────────────────────────────

describe('buildGalleryRows', () => {
  it('emits a month divider then dense rows of at most GALLERY_COLUMNS photos', () => {
    const photos = Array.from({ length: 7 }, (_, index) => photoItem(`p${index}`));
    const rows = buildGalleryRows([section({ items: photos })]);

    expect(rows[0]).toMatchObject({ kind: 'month', key: 'month:2026-03' });
    const gridRows = rows.slice(1);
    expect(gridRows.map((row) => (row.kind === 'grid' ? row.photos.length : 0))).toEqual([
      GALLERY_COLUMNS,
      GALLERY_COLUMNS,
      1,
    ]);
    // Tile labels count within the month's PHOTOS, so "3 of 7" is true.
    expect(gridRows[0]).toMatchObject({
      kind: 'grid',
      sectionLabel: 'March 2026',
      photoStartIndex: 0,
      photoTotal: 7,
    });
    expect(gridRows[2]).toMatchObject({ kind: 'grid', photoStartIndex: 6 });
  });

  it('gives video and voice their own full-width row, between the photo runs', () => {
    const rows = buildGalleryRows([
      section({
        items: [
          photoItem('p1'),
          photoItem('p2'),
          { ...photoItem('clip'), kind: 'video', posterUri: 'file:///poster.jpg' },
          photoItem('p3'),
          voiceItem('v1'),
          photoItem('p4'),
        ],
      }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual([
      'month',
      'grid',
      'media',
      'grid',
      'media',
      'grid',
    ]);
    // The photo run is cut at the clip: media never shares a tile row.
    expect(rows[1]).toMatchObject({ kind: 'grid', photos: [{ key: 'p1' }, { key: 'p2' }] });
    expect(rows[2]).toMatchObject({ kind: 'media', item: { key: 'clip', kind: 'video' } });
    expect(rows[3]).toMatchObject({ kind: 'grid', photos: [{ key: 'p3' }] });
    expect(rows[4]).toMatchObject({ kind: 'media', item: { key: 'v1', kind: 'voice' } });
    expect(rows[5]).toMatchObject({ kind: 'grid', photos: [{ key: 'p4' }] });
  });

  it('keeps each month grouped under its own divider, keys stable', () => {
    const rows = buildGalleryRows([
      section({ items: [photoItem('one'), photoItem('two')] }),
      section({
        id: 'month:2026-02',
        monthKey: '2026-02',
        label: 'February 2026',
        items: [photoItem('three')],
      }),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['month', 'grid', 'month', 'grid']);
    expect(rows.map((row) => row.key)).toEqual([
      'month:2026-03',
      'grid:2026-03:one',
      'month:2026-02',
      'grid:2026-02:three',
    ]);
  });

  it('emits nothing but the divider for a month whose media is all on rows', () => {
    const rows = buildGalleryRows([section({ items: [voiceItem('v1')] })]);
    expect(rows.map((row) => row.kind)).toEqual(['month', 'media']);
  });
});

// ── formatGalleryCounts ─────────────────────────────────────────────────

describe('formatGalleryCounts', () => {
  it('names only the kinds the month holds, in the order they earn space', () => {
    expect(formatGalleryCounts({ photo: 1, video: 0, voice: 0 })).toBe('1 photo');
    expect(formatGalleryCounts({ photo: 12, video: 1, voice: 2 })).toBe(
      '12 photos · 1 video · 2 voice notes',
    );
    expect(formatGalleryCounts({ photo: 0, video: 0, voice: 3 })).toBe('3 voice notes');
  });

  it('reads empty rather than "0 photos"', () => {
    expect(formatGalleryCounts({ photo: 0, video: 0, voice: 0 })).toBe('');
  });
});
