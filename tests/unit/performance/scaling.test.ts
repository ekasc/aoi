import { describe, expect, it, vi } from 'vitest';

import { createLocalCollectionsRepository } from '@/features/collections/local-collections-repository';
import { previewFromItems } from '@/features/collections/collection-preview';
import { layoutDayEvents } from '@/features/calendar/day-layout';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Collection, CollectionItem } from '@/features/collections/types';
import { buildPhotoSkyField } from '@/features/home/photo-sky';
import { nearestPhotoSkyStar } from '@/features/home/photo-sky-camera';
import { buildGalleryRows, buildGallerySections } from '@/features/moments/gallery';
import { groupFeedChronological } from '@/features/moments/story-feed';
import type { Moment } from '@/features/moments/types';

function timed<T>(name: string, count: number, run: () => T): T {
  const start = performance.now();
  const value = run();
  console.log(JSON.stringify({ benchmark: name, count, ms: Number((performance.now() - start).toFixed(2)), environment: 'desktop happy-dom; not device timing' }));
  return value;
}

describe('large archive behavior and scaling diagnostics', () => {
  it.each([100, 1000])('assigns distinct columns to %i simultaneous calendar events', (count) => {
    const events: CalendarEvent[] = Array.from({ length: count }, (_, index) => ({
      id: `event-${index}`, title: `Event ${index}`, startsAt: '2026-10-12T10:00:00', endsAt: '2026-10-12T11:00:00',
      actor: 'you', actorName: 'Test', label: { preset: 'Date' }, createdAt: '2026-10-12T00:00:00', updatedAt: '2026-10-12T00:00:00',
    }));
    const placed = timed('overlapping-day-layout', count, () => layoutDayEvents(events));
    expect(placed).toHaveLength(count);
    expect(new Set(placed.map(event => event.column)).size).toBe(count);
    expect(placed.every(event => event.columnCount === count)).toBe(true);
  });
  it.each([100, 1000, 10000])('preserves every memory and photo at %i entries', (count) => {
    const moments: Moment[] = Array.from({ length: count }, (_, index) => ({
      id: `stress-${index}`, type: 'media', title: '', body: '',
      occurredAt: new Date(2020 + index % 6, index % 12, 1 + index % 28).toISOString(),
      createdAt: '2026-01-01T00:00:00Z', authorId: 'stress-user', authorRole: 'you', authorName: 'Test',
      attachments: [{ mediaId: `photo-${index}`, kind: 'image', url: 'https://example.invalid/photo.jpg' }],
    }));
    const originalIds = moments.map(moment => moment.id);
    const sections = timed('feed-grouping', count, () => groupFeedChronological(moments));
    expect(sections.reduce((total, section) => total + section.moments.length, 0)).toBe(count);
    const gallery = timed('gallery-grouping-and-rows', count, () => buildGalleryRows(buildGallerySections(moments)));
    expect(gallery.reduce((total, row) => total + (row.kind === 'grid' ? row.items.length : 0), 0)).toBe(count);
    const field = timed('photo-sky-field', count, () => buildPhotoSkyField(moments));
    expect(new Set(field.map(star => star.id)).size).toBe(count);
    const index = timed('sky-nearest-60-scans', count, () => {
      let nearest = -1;
      for (let frame = 0; frame < 60; frame++) {
        nearest = nearestPhotoSkyStar(field, { x: frame / 1000, y: 0, zoom: 5 }, { width: 390, height: 700 }, { x: 195, y: 350 });
      }
      return nearest;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(count);
    expect(moments.map(moment => moment.id)).toEqual(originalIds);
  });

  it('preserves counts across 100 lists and 10000 items when loading every preview', async () => {
    const spaceId = 'performance-test-only';
    const key = `aoi.collections.v1.${spaceId}`;
    const stamp = '2026-01-01T00:00:00Z';
    const collections: Collection[] = Array.from({ length: 100 }, (_, index) => ({
      id: `list-${index}`, name: `List ${index}`, emoji: null, position: index, itemCount: 0, createdAt: stamp, updatedAt: stamp,
    }));
    const items: CollectionItem[] = Array.from({ length: 10000 }, (_, index) => ({
      id: `item-${index}`, collectionId: `list-${index % 100}`, title: `Item ${index}`, position: index,
      note: null, link: null, createdAt: stamp, updatedAt: stamp,
    }));
    const raw = JSON.stringify({ collections, items });
    const storage = globalThis.__mockAsyncStorage;
    await storage.setItem(key, raw);
    const spy = vi.spyOn(storage, 'getItem');
    try {
      const repo = createLocalCollectionsRepository(spaceId);
      const fanOutStart = performance.now();
      const lists = await repo.listCollections();
      const fanOutPreviews = await Promise.all(lists.map(list => repo.listItems(list.id)));
      const fanOutMs = Number((performance.now() - fanOutStart).toFixed(2));
      const fanOutReads = spy.mock.calls.length;
      console.log(JSON.stringify({ benchmark: 'local-list-preview-fanout', lists: lists.length, items: items.length, ms: fanOutMs, blobBytes: raw.length, fullBlobReads: fanOutReads, environment: 'mock storage; real parse/filter/sort' }));

      const onePassStart = performance.now();
      const onePass = await repo.listPreviews(lists.map(list => list.id));
      const onePassMs = Number((performance.now() - onePassStart).toFixed(2));
      const onePassReads = spy.mock.calls.length - fanOutReads;
      console.log(JSON.stringify({ benchmark: 'local-list-previews-one-pass', lists: lists.length, items: items.length, ms: onePassMs, fullBlobReads: onePassReads, environment: 'mock storage; real parse/filter/sort' }));

      expect(lists.every(list => list.itemCount === 100)).toBe(true);
      expect(fanOutPreviews.reduce((total, preview) => total + preview.length, 0)).toBe(items.length);
      expect(new Set(fanOutPreviews.flat().map(item => item.id)).size).toBe(items.length);
      // The whole point: every shelf's preview from one read of the store, and
      // the same answer the per-shelf reads gave.
      expect(onePassReads).toBe(1);
      lists.forEach((list, index) => {
        expect(onePass[list.id]).toEqual(previewFromItems(fanOutPreviews[index]));
      });
    } finally {
      spy.mockRestore();
      await storage.removeItem(key);
    }
  }, 20000);
});
