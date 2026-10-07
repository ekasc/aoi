import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { AppState } from 'react-native';

import {
  CollectionsProvider,
  useCollections,
} from '@/features/collections/collections-context';
import type { Collection, CollectionItem, CollectionsContextValue } from '@/features/collections/types';

const fakeRepository = {
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
};

vi.mock('@/features/collections/local-collections-repository', () => ({
  createLocalCollectionsRepository: () => fakeRepository,
}));

vi.mock('@/features/api-client', () => ({
  isStubMode: () => true,
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { id: 'user-you', displayName: 'You' } }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space-1' } }),
}));

let captured: CollectionsContextValue | null = null;

function Probe() {
  captured = useCollections();
  return null;
}

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

async function renderProvider() {
  const view = render(
    <CollectionsProvider>
      <Probe />
    </CollectionsProvider>
  );
  await waitFor(() => expect(captured?.isLoading).toBe(false));
  return view;
}

describe('CollectionsProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
  });

  it('loads shelves and sorts them by position', async () => {
    const later = makeCollection({ id: 'later', name: 'Later', position: 4 });
    const first = makeCollection({ id: 'first', name: 'First', position: 1 });
    fakeRepository.listCollections.mockResolvedValue([later, first]);

    await renderProvider();

    expect(fakeRepository.listCollections).toHaveBeenCalledTimes(1);
    expect(captured?.collections.map((collection) => collection.id)).toEqual(['first', 'later']);
    expect(captured?.error).toBeNull();
  });

  it('surfaces a gentle error when the shelves cannot be loaded', async () => {
    fakeRepository.listCollections.mockRejectedValue(new Error('network down'));

    await renderProvider();

    expect(captured?.error).toBe('Your lists could not be loaded right now.');
    expect(captured?.collections).toEqual([]);
  });

  it('createCollection appends the created shelf in order', async () => {
    fakeRepository.listCollections.mockResolvedValue([]);
    await renderProvider();

    const created = makeCollection({ id: 'new', position: 0 });
    fakeRepository.createCollection.mockResolvedValue(created);

    await act(async () => {
      await captured?.createCollection({ name: 'Films to watch', emoji: '🎬' });
    });

    expect(fakeRepository.createCollection).toHaveBeenCalledWith({
      name: 'Films to watch',
      emoji: '🎬',
    });
    expect(captured?.collections.map((collection) => collection.id)).toEqual(['new']);
  });

  it('updateCollection replaces the shelf in place', async () => {
    fakeRepository.listCollections.mockResolvedValue([makeCollection({ id: 'a', name: 'Old' })]);
    await renderProvider();

    const updated = makeCollection({ id: 'a', name: 'New' });
    fakeRepository.updateCollection.mockResolvedValue(updated);

    await act(async () => {
      await captured?.updateCollection('a', { name: 'New' });
    });

    expect(captured?.collections[0].name).toBe('New');
  });

  it('moveCollection swaps neighbours and normalises positions', async () => {
    const a = makeCollection({ id: 'a', position: 0 });
    const b = makeCollection({ id: 'b', position: 1 });
    const c = makeCollection({ id: 'c', position: 2 });
    fakeRepository.listCollections.mockResolvedValue([a, b, c]);
    await renderProvider();

    fakeRepository.updateCollection.mockImplementation(async (id, input) => ({
      ...(id === 'a' ? a : id === 'b' ? b : c),
      ...input,
    }));

    await act(async () => {
      await captured?.moveCollection('a', 1);
    });

    // a and b swap; c keeps position 2, so only the two moved rows write.
    expect(fakeRepository.updateCollection.mock.calls).toContainEqual(['b', { position: 0 }]);
    expect(fakeRepository.updateCollection.mock.calls).toContainEqual(['a', { position: 1 }]);
    expect(fakeRepository.updateCollection.mock.calls).not.toContainEqual(['c', { position: 2 }]);
  });

  it('moveCollection does nothing at the ends of the list', async () => {
    fakeRepository.listCollections.mockResolvedValue([makeCollection({ id: 'a', position: 0 })]);
    await renderProvider();

    await act(async () => {
      await captured?.moveCollection('a', -1);
    });

    expect(fakeRepository.updateCollection).not.toHaveBeenCalled();
  });

  it('deleteCollection removes the shelf', async () => {
    fakeRepository.listCollections.mockResolvedValue([makeCollection({ id: 'a' })]);
    fakeRepository.deleteCollection.mockResolvedValue(undefined);
    await renderProvider();

    await act(async () => {
      await captured?.deleteCollection('a');
    });

    expect(captured?.collections).toEqual([]);
  });

  it('createItem bumps the shelf item count', async () => {
    fakeRepository.listCollections.mockResolvedValue([makeCollection({ id: 'a', itemCount: 1 })]);
    await renderProvider();

    fakeRepository.createItem.mockResolvedValue(makeItem({ collectionId: 'a' }));

    await act(async () => {
      await captured?.createItem('a', { title: 'Spirited Away' });
    });

    expect(captured?.collections[0].itemCount).toBe(2);
  });

  it('deleteItem lowers the shelf item count without going below zero', async () => {
    fakeRepository.listCollections.mockResolvedValue([makeCollection({ id: 'a', itemCount: 0 })]);
    fakeRepository.deleteItem.mockResolvedValue(undefined);
    await renderProvider();

    await act(async () => {
      await captured?.deleteItem('a', 'item-1');
    });

    expect(captured?.collections[0].itemCount).toBe(0);
  });

  it('listItems delegates to the repository', async () => {
    fakeRepository.listCollections.mockResolvedValue([]);
    await renderProvider();

    const items = [makeItem({ id: 'i1' })];
    fakeRepository.listItems.mockResolvedValue(items);

    await act(async () => {
      const result = await captured?.listItems('a');
      expect(result).toEqual(items);
    });
  });

  it('does not subscribe to focus changes in stub mode', async () => {
    const addEventListenerSpy = vi.spyOn(AppState, 'addEventListener');
    fakeRepository.listCollections.mockResolvedValue([]);

    await renderProvider();

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });
});
