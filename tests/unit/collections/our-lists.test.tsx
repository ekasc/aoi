import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { OurLists } from '@/components/collections/our-lists';
import type { Collection, CollectionItem } from '@/features/collections/types';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  reload: vi.fn(async () => {}),
  createCollection: vi.fn(async () => ({})),
  moveCollection: vi.fn(async () => {}),
  listItems: vi.fn(async () => [] as CollectionItem[]),
}));

const state = vi.hoisted(() => ({
  collections: [] as Collection[],
  isLoading: false,
  error: null as string | null,
}));

vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({
    collections: state.collections,
    isLoading: state.isLoading,
    error: state.error,
    reload: mocks.reload,
    createCollection: mocks.createCollection,
    moveCollection: mocks.moveCollection,
    listItems: mocks.listItems,
  }),
}));

vi.mock('moti', () => {
  return { MotiView: ({ children }: { children: ReactNode }) => createElement('div', null, children) };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'shelf-1',
    name: 'Films to watch',
    emoji: null,
    color: null,
    position: 0,
    itemCount: 2,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 'item-1',
    collectionId: 'shelf-1',
    title: 'Spirited Away',
    position: 0,
    note: null,
    link: null,
    coverUrl: null,
    status: null,
    score: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCollection.mockResolvedValue({});
  mocks.moveCollection.mockResolvedValue(undefined);
  mocks.listItems.mockResolvedValue([]);
  state.collections = [];
  state.isLoading = false;
  state.error = null;
});

describe('Our lists', () => {
  it('opens the creation sheet from the empty list action', () => {
    render(<OurLists />);
    fireEvent.click(screen.getByLabelText('New list'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/collection/new');
    expect(mocks.createCollection).not.toHaveBeenCalled();
  });

  it('says what is inside a list before you open it', async () => {
    state.collections = [makeCollection({ id: 'shelf-1', name: 'Films to watch' })];
    mocks.listItems.mockResolvedValue([
      makeItem({ id: 'a', status: 'done' }),
      makeItem({ id: 'b', status: 'want' }),
    ]);
    render(<OurLists />);

    // The count and the make-up are in the spoken name, so a list reads as a
    // shelf with something on it rather than a name.
    expect(await screen.findByLabelText('Films to watch, 2 things · 1 done')).toBeTruthy();
  });

  it('opens a list when its row is pressed', async () => {
    state.collections = [makeCollection()];
    mocks.listItems.mockResolvedValue([makeItem({ status: 'done' }), makeItem({ id: 'b' })]);
    render(<OurLists />);

    fireEvent.click(await screen.findByLabelText('Films to watch, 2 things · 1 done'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/collection/shelf-1');
  });

  it('moves a list down from its row actions, and only offers what applies', () => {
    state.collections = [
      makeCollection({ id: 'first', name: 'First' }),
      makeCollection({ id: 'second', name: 'Second' }),
    ];
    render(<OurLists />);

    // The first list cannot move up; it can move down.
    const menu = screen.getByLabelText('Actions for First');
    expect(menu.querySelector('option[value="up"]')).toBeNull();
    fireEvent.change(menu, { target: { value: 'down' } });
    expect(mocks.moveCollection).toHaveBeenCalledWith('first', 1);
  });

  it('reports a failed reorder and permits retrying without navigating', async () => {
    state.collections = [makeCollection({ id: 'first', name: 'First' }), makeCollection({ id: 'second', name: 'Second' })];
    mocks.moveCollection.mockRejectedValueOnce(new Error('Unavailable'));
    render(<OurLists />);
    fireEvent.change(screen.getByLabelText('Actions for First'), { target: { value: 'down' } });
    await screen.findByText("Couldn't reorder your lists. Please try again.");
    fireEvent.change(screen.getByLabelText('Actions for First'), { target: { value: 'down' } });
    await waitFor(() => expect(mocks.moveCollection).toHaveBeenCalledTimes(2));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('offers no reorder at all for a single list', () => {
    state.collections = [makeCollection({ id: 'only', name: 'Only' })];
    render(<OurLists />);

    // Nothing to move, so there must be no actions button — it used to open an
    // empty sheet showing only the list's name.
    expect(screen.queryByLabelText('Actions for Only')).toBeNull();
  });

  it('keeps a failed read distinct from the empty invitation, with a retry', () => {
    state.error = 'Your lists could not be loaded right now.';
    render(<OurLists />);

    expect(
      screen.queryByText('No lists yet. Name one, then add whatever belongs in it.')
    ).toBeNull();
    expect(screen.getByText('Your lists could not be loaded right now.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Try again'));
    expect(mocks.reload).toHaveBeenCalled();
  });

  it('keeps loading distinct from the empty invitation', () => {
    state.isLoading = true;
    render(<OurLists />);

    expect(
      screen.queryByText('No lists yet. Name one, then add whatever belongs in it.')
    ).toBeNull();
  });
});
