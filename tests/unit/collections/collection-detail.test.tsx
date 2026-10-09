import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { Collection, CollectionItem } from '@/features/collections/types';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  listItems: vi.fn(),
  deleteCollection: vi.fn(),
}));

const state = vi.hoisted(() => ({
  collections: [] as Collection[],
  isLoading: false,
}));

const capturedScreenOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({
    collections: state.collections,
    isLoading: state.isLoading,
    listItems: mocks.listItems,
    deleteCollection: mocks.deleteCollection,
  }),
}));

vi.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mocks.push, back: mocks.back }),
    useLocalSearchParams: () => ({ id: 'shelf-1' }),
    // The real hook runs the callback on focus and whenever it changes. Run it
    // on identity change, which covers both the first load and a retry.
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => effect(), [effect]);
    },
    Stack: {
      Screen: ({ options }: { options?: Record<string, unknown> }) => {
        capturedScreenOptions.push(options ?? {});
        return null;
      },
    },
  };
});

// The global theme stand-in omits a few tokens (shadow, muted, accent). Pin a
// colour for every token so surfaces and ink resolve instead of coming back
// undefined.
vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import CollectionDetailScreen from '@/app/(app)/collection/[id]/index';

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'shelf-1',
    name: 'Films to watch',
    emoji: null,
    color: null,
    position: 0,
    itemCount: 1,
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

async function renderScreen() {
  const view = render(<CollectionDetailScreen />);
  await waitFor(() => expect(mocks.listItems).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedScreenOptions.length = 0;
  state.collections = [makeCollection()];
  state.isLoading = false;
  mocks.listItems.mockResolvedValue([makeItem()]);
  mocks.deleteCollection.mockResolvedValue(undefined);
});

describe('List page', () => {
  it('carries a thing’s state in its spoken name', async () => {
    mocks.listItems.mockResolvedValue([makeItem({ status: 'doing', score: 7 })]);
    await renderScreen();

    // State lives in the name, not only in paint — a screen reader gets it.
    expect(screen.getByLabelText('Spirited Away, Doing, scored 7 of 10')).toBeTruthy();
  });

  it('filters the catalogue by status without losing the others', async () => {
    mocks.listItems.mockResolvedValue([
      makeItem({ id: 'a', title: 'Wanted', status: 'want' }),
      makeItem({ id: 'b', title: 'Doing it', status: 'doing' }),
    ]);
    await renderScreen();

    expect(screen.getByLabelText('Wanted, Want')).toBeTruthy();
    expect(screen.getByLabelText('Doing it, Doing')).toBeTruthy();

    // The status filter now lives behind one control: open it, choose a status.
    fireEvent.change(screen.getByLabelText('Filter and sort'), { target: { value: 'filter:doing' } });
    expect(screen.queryByLabelText('Wanted, Want')).toBeNull();
    expect(screen.getByLabelText('Doing it, Doing')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter and sort'), { target: { value: 'filter:all' } });
    expect(screen.getByLabelText('Wanted, Want')).toBeTruthy();
  });

  it('clears each choice independently and restores the catalogue order', async () => {
    mocks.listItems.mockResolvedValue([
      makeItem({ id: 'z', title: 'Zulu', position: 0, status: 'doing' }),
      makeItem({ id: 'a', title: 'Alpha', position: 1, status: 'want' }),
    ]);
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Filter and sort'), { target: { value: 'sort:title' } });
    fireEvent.change(screen.getByLabelText('Filter and sort'), { target: { value: 'filter:doing' } });
    expect(screen.queryByLabelText('Alpha, Want')).toBeNull();

    fireEvent.click(screen.getByLabelText('Clear filter Doing'));
    const alpha = screen.getByLabelText('Alpha, Want');
    const zulu = screen.getByLabelText('Zulu, Doing');
    expect(alpha.compareDocumentPosition(zulu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Reset sort Title'));
    expect(screen.getByLabelText('Zulu, Doing').compareDocumentPosition(screen.getByLabelText('Alpha, Want')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a thing’s own page rather than editing inside the list', async () => {
    await renderScreen();

    fireEvent.click(screen.getByLabelText('Spirited Away'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/collection/shelf-1/item/item-1');
  });

  it('sends you to a page to add a thing, never an inline form', async () => {
    mocks.listItems.mockResolvedValue([]);
    await renderScreen();

    fireEvent.click(screen.getByLabelText('Add a thing'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/collection/shelf-1/item/new');
  });

  it('puts the list’s own name in the header and reaches its editor', async () => {
    await renderScreen();

    const options = capturedScreenOptions.at(-1) as
      | { title?: string; headerRight?: () => ReactElement }
      | undefined;
    expect(options?.title).toBe('Films to watch');

    // Scope to the header's own container: "Add a thing" is also the foot
    // row's label, because it is the same action.
    const header = render(<>{options?.headerRight?.()}</>);
    const inHeader = within(header.container);

    fireEvent.click(inHeader.getByLabelText('Edit list'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/collection/shelf-1/edit');
  });

  it('keeps an empty list distinct from a failed read, with a retry', async () => {
    mocks.listItems.mockResolvedValue([]);
    const { unmount } = render(<CollectionDetailScreen />);
    await waitFor(() =>
      expect(screen.getByText('Nothing in this list yet.')).toBeTruthy()
    );
    unmount();

    mocks.listItems.mockRejectedValueOnce(new Error('network down'));
    mocks.listItems.mockResolvedValueOnce([]);
    render(<CollectionDetailScreen />);

    expect(
      await screen.findByText('These things could not be loaded right now.')
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Try again'));

    await waitFor(() =>
      expect(screen.queryByText('These things could not be loaded right now.')).toBeNull()
    );
  });

  it('removes the list after a confirmation, for both partners', async () => {
    await renderScreen();

    fireEvent.click(screen.getByText('Remove list'));
    expect(
      await screen.findByText(/This removes the list and everything in it for both of you/)
    ).toBeTruthy();
    expect(mocks.deleteCollection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Confirm remove Films to watch'));
    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith('shelf-1'));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('keeps the list when its removal fails, so it can be retried', async () => {
    mocks.deleteCollection.mockRejectedValueOnce(new Error('offline'));
    await renderScreen();

    fireEvent.click(screen.getByText('Remove list'));
    fireEvent.click(screen.getByLabelText('Confirm remove Films to watch'));

    expect(
      await screen.findByText("Couldn't remove this list. Please try again.")
    ).toBeTruthy();
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('honestly reports a list that is no longer there', () => {
    state.collections = [];
    render(<CollectionDetailScreen />);

    expect(screen.getByText('List not found')).toBeTruthy();
  });
});
