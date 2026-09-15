import { describe, expect, it } from 'vitest';

import {
  GALLERY_COLUMNS,
  buildGalleryRows,
  buildGallerySections,
  galleryPhotosOf,
  type GalleryPhoto,
} from '@/features/moments/gallery';
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
    authorName: 'You',
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

function keys(photos: GalleryPhoto[]): string[] {
  return photos.map((photo) => photo.key);
}

// ── galleryPhotosOf ─────────────────────────────────────────────────────

describe('galleryPhotosOf', () => {
  it('extracts every ordered photo as its own tile, in server order', () => {
    const moment = makeMoment({ id: 'photo-1', attachments: [image('a'), image('b')] });
    expect(galleryPhotosOf(moment)).toEqual([
      { key: 'photo-1:a', momentId: 'photo-1', mediaId: 'a', uri: 'https://cdn.test/a' },
      { key: 'photo-1:b', momentId: 'photo-1', mediaId: 'b', uri: 'https://cdn.test/b' },
    ]);
  });

  it('keeps the parent moment id on every ordered tile', () => {
    const moment = makeMoment({ id: 'shared-moment', attachments: [image('a'), image('b')] });
    expect(galleryPhotosOf(moment).map((photo) => photo.momentId)).toEqual([
      'shared-moment',
      'shared-moment',
    ]);
  });

  it('ignores audio attachments (no video, no non-photo tiles)', () => {
    const moment = makeMoment({ id: 'mixed', attachments: [audio('a1'), image('i1'), audio('a2')] });
    expect(keys(galleryPhotosOf(moment))).toEqual(['mixed:i1']);
  });

  it('falls back to the legacy single photo when there are no ordered attachments', () => {
    const moment = makeMoment({
      id: 'legacy',
      mediaPreview: 'file:///legacy.jpg',
      mediaId: 'media-legacy',
    });
    expect(galleryPhotosOf(moment)).toEqual([
      {
        key: 'legacy:legacy',
        momentId: 'legacy',
        mediaId: 'media-legacy',
        uri: 'file:///legacy.jpg',
      },
    ]);
  });

  it('never duplicates the first photo when attachments and a legacy preview coexist', () => {
    const moment = makeMoment({
      id: 'both',
      mediaPreview: 'file:///derived.jpg',
      mediaId: 'media-first',
      attachments: [image('a')],
    });
    const photos = galleryPhotosOf(moment);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toEqual({
      key: 'both:a',
      momentId: 'both',
      mediaId: 'a',
      uri: 'https://cdn.test/a',
    });
  });

  it('returns nothing for text-only or audio-only memories', () => {
    expect(galleryPhotosOf(makeMoment({ id: 'note' }))).toEqual([]);
    expect(
      galleryPhotosOf(makeMoment({ id: 'voice', type: 'trace', audioUri: 'file:///v.m4a' })),
    ).toEqual([]);
    expect(
      galleryPhotosOf(makeMoment({ id: 'audio-only', attachments: [audio('a1')] })),
    ).toEqual([]);
  });
});

// ── buildGallerySections ────────────────────────────────────────────────

describe('buildGallerySections', () => {
  it('groups photos into oldest-first month sections and drops photo-less months', () => {
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
      makeMoment({ id: 'janvoice', type: 'trace', audioUri: 'a', occurredAt: '2026-01-05T10:00:00.000Z' }),
    ];

    const sections = buildGallerySections(moments);
    expect(sections.map((section) => section.id)).toEqual(['month:2026-02', 'month:2026-03']);
    expect(sections[1].label).toBe('March 2026');
    expect(keys(sections[1].photos)).toEqual(['mar-photo:m1', 'mar-photo:m2']);
    expect(keys(sections[0].photos)).toEqual(['feb-photo:legacy']);
  });

  it('parks undated photos in a trailing Undated section', () => {
    const sections = buildGallerySections([
      makeMoment({ id: 'bad', mediaPreview: 'file:///x.jpg', occurredAt: 'not-a-date' }),
      makeMoment({ id: 'good', mediaPreview: 'file:///g.jpg', occurredAt: '2026-03-15T10:00:00.000Z' }),
    ]);
    expect(sections.map((section) => section.monthKey)).toEqual(['2026-03', 'undated']);
    expect(sections[1].label).toBe('Undated');
  });
});

// ── buildGalleryRows ────────────────────────────────────────────────────

describe('buildGalleryRows', () => {
  it('emits a month heading then dense rows of at most GALLERY_COLUMNS tiles', () => {
    const photos: GalleryPhoto[] = Array.from({ length: 7 }, (_, index) => ({
      key: `m:p${index}`,
      momentId: 'm',
      mediaId: `p${index}`,
      uri: `https://cdn.test/p${index}`,
    }));
    const rows = buildGalleryRows([
      { id: 'month:2026-03', monthKey: '2026-03', label: 'March 2026', photos },
    ]);

    expect(rows[0]).toEqual({ kind: 'month', key: 'month:2026-03', label: 'March 2026' });
    const gridRows = rows.slice(1);
    expect(gridRows.map((row) => (row.kind === 'grid' ? row.photos.length : 0))).toEqual([
      GALLERY_COLUMNS,
      GALLERY_COLUMNS,
      1,
    ]);
    expect(gridRows[0]).toMatchObject({ kind: 'grid', sectionLabel: 'March 2026', startIndex: 0 });
    expect(gridRows[2]).toMatchObject({ kind: 'grid', startIndex: 6 });
  });

  it('keeps each month grouped with its own heading in order', () => {
    const one = { key: 'one' } as unknown as GalleryPhoto;
    const two = { key: 'two' } as unknown as GalleryPhoto;
    const rows = buildGalleryRows([
      { id: 'month:2026-03', monthKey: '2026-03', label: 'March 2026', photos: [one, two] },
      { id: 'month:2026-02', monthKey: '2026-02', label: 'February 2026', photos: [one] },
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['month', 'grid', 'month', 'grid']);
    expect(rows.map((row) => row.key)).toEqual([
      'month:2026-03',
      'grid:2026-03:0',
      'month:2026-02',
      'grid:2026-02:0',
    ]);
  });
});
