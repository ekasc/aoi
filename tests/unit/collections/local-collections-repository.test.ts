import { describe, it, expect, beforeEach } from 'vitest';

import { createLocalCollectionsRepository } from '@/features/collections/local-collections-repository';
import type { Collection, CollectionItem } from '@/features/collections/types';

const mockStorage = (globalThis as any).__mockAsyncStorage;

const KEY = (spaceId: string) => `aoi.collections.v1.${spaceId}`;

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: `collection_${Math.floor(Math.random() * 1000000)}`,
    name: 'Films to watch',
    emoji: '🎬',
    position: 0,
    itemCount: 0,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: `collection_item_${Math.floor(Math.random() * 1000000)}`,
    collectionId: 'collection-1',
    title: 'Spirited Away',
    position: 0,
    note: null,
    link: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

async function seed(spaceId: string, collections: Collection[], items: CollectionItem[] = []) {
  await mockStorage.setItem(KEY(spaceId), JSON.stringify({ collections, items }));
}

describe('local collections repository', () => {
  beforeEach(async () => {
    await mockStorage.clear();
  });

  it('creates shelves and lists them in position order with a live item count', async () => {
    const repo = createLocalCollectionsRepository('space-1');

    await repo.createCollection({ name: 'Films to watch', emoji: '🎬' });
    await repo.createCollection({ name: 'Cafés we love', emoji: '☕' });

    const collections = await repo.listCollections();
    expect(collections.map((collection) => collection.name)).toEqual([
      'Films to watch',
      'Cafés we love',
    ]);
    expect(collections[0]).toMatchObject({ emoji: '🎬', position: 0, itemCount: 0 });
    expect(collections[1].position).toBe(1);
  });

  it('trims names and treats a blank emoji as none', async () => {
    const repo = createLocalCollectionsRepository('space-1');

    const created = await repo.createCollection({ name: '  Rules we broke  ', emoji: '   ' });
    expect(created.name).toBe('Rules we broke');
    expect(created.emoji).toBeNull();
  });

  it('rejects blank and oversized shelf names', async () => {
    const repo = createLocalCollectionsRepository('space-1');

    await expect(repo.createCollection({ name: '   ' })).rejects.toThrow();
    await expect(repo.createCollection({ name: 'a'.repeat(61) })).rejects.toThrow();
  });

  it('adds items and reports the count on the shelf', async () => {
    const repo = createLocalCollectionsRepository('space-1');
    const shelf = await repo.createCollection({ name: 'Films to watch' });

    const first = await repo.createItem(shelf.id, { title: 'Spirited Away', note: '  Ghibli ' });
    await repo.createItem(shelf.id, { title: 'Perfect Days', link: 'https://example.com/pd' });

    expect(first).toMatchObject({ title: 'Spirited Away', note: 'Ghibli', link: null });

    const collections = await repo.listCollections();
    expect(collections[0].itemCount).toBe(2);

    const items = await repo.listItems(shelf.id);
    expect(items.map((item) => item.title)).toEqual(['Spirited Away', 'Perfect Days']);
    expect(items[1]).toMatchObject({ note: null, link: 'https://example.com/pd' });
  });

  it('rejects a blank title and keeps items ordered by position', async () => {
    const repo = createLocalCollectionsRepository('space-1');
    const shelf = await repo.createCollection({ name: 'Films to watch' });

    await expect(repo.createItem(shelf.id, { title: '  ' })).rejects.toThrow();

    await seed(
      'space-1',
      [makeCollection({ id: shelf.id })],
      [
        makeItem({ id: 'b', collectionId: shelf.id, title: 'Second', position: 3 }),
        makeItem({ id: 'a', collectionId: shelf.id, title: 'First', position: 1 }),
      ]
    );

    const items = await repo.listItems(shelf.id);
    expect(items.map((item) => item.title)).toEqual(['First', 'Second']);
  });

  it('updates a shelf and an item, clearing an emptied note', async () => {
    const repo = createLocalCollectionsRepository('space-1');
    const shelf = await repo.createCollection({ name: 'Films to watch' });
    const item = await repo.createItem(shelf.id, { title: 'Spirited Away', note: 'bring snacks' });

    const updatedShelf = await repo.updateCollection(shelf.id, { name: 'Films we love' });
    expect(updatedShelf.name).toBe('Films we love');

    const updatedItem = await repo.updateItem(item.id, { title: 'Spirited', note: '' });
    expect(updatedItem).toMatchObject({ title: 'Spirited', note: null });
  });

  it('throws when updating a missing shelf or item', async () => {
    const repo = createLocalCollectionsRepository('space-1');
    await expect(repo.updateCollection('missing', { name: 'x' })).rejects.toThrow();
    await expect(repo.updateItem('missing', { title: 'x' })).rejects.toThrow();
  });

  it('removes an item and removes a shelf with its items', async () => {
    const repo = createLocalCollectionsRepository('space-1');
    const shelf = await repo.createCollection({ name: 'Films to watch' });
    const item = await repo.createItem(shelf.id, { title: 'Spirited Away' });

    await repo.deleteItem(item.id);
    expect(await repo.listItems(shelf.id)).toEqual([]);

    await repo.createItem(shelf.id, { title: 'Perfect Days' });
    await repo.deleteCollection(shelf.id);
    expect(await repo.listCollections()).toEqual([]);
    expect(await repo.listItems(shelf.id)).toEqual([]);
  });

  it('keeps shelves separate per active space', async () => {
    const mine = createLocalCollectionsRepository('space-1');
    const theirs = createLocalCollectionsRepository('space-2');

    await mine.createCollection({ name: 'Ours only' });

    expect(await theirs.listCollections()).toEqual([]);
    expect(await mine.listCollections()).toHaveLength(1);
  });

  it('recovers gracefully from corrupted stored JSON', async () => {
    await mockStorage.setItem(KEY('space-1'), '{not valid json');
    const repo = createLocalCollectionsRepository('space-1');
    expect(await repo.listCollections()).toEqual([]);
  });

  it('filters out malformed stored entries', async () => {
    await seed('space-1', [
      makeCollection({ id: 'good', name: 'Good' }),
      { id: 'bad', name: 42 } as unknown as Collection,
      null as unknown as Collection,
    ]);

    const repo = createLocalCollectionsRepository('space-1');
    const collections = await repo.listCollections();
    expect(collections.map((collection) => collection.id)).toEqual(['good']);
  });
});
