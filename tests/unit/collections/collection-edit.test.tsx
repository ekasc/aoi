import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import type { Collection } from '@/features/collections/types';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  dismissTo: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));

const state = vi.hoisted(() => ({
  collections: [] as Collection[],
  isLoading: false,
}));

vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({
    collections: state.collections,
    isLoading: state.isLoading,
    updateCollection: mocks.updateCollection,
    deleteCollection: mocks.deleteCollection,
  }),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  useRouter: () => ({ push: mocks.push, back: mocks.back, dismissTo: mocks.dismissTo }),
  useLocalSearchParams: () => ({ id: 'shelf-1' }),
  Stack: { Screen: () => null },
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import EditListScreen from '@/app/(app)/collection/[id]/edit';

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'shelf-1',
    name: 'Films to watch',
    emoji: null,
    color: null,
    position: 0,
    itemCount: 0,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.collections = [makeCollection()];
  state.isLoading = false;
  mocks.updateCollection.mockResolvedValue(makeCollection());
  mocks.deleteCollection.mockResolvedValue(undefined);
});

describe('Edit list', () => {
  it('prefills the list and saves the name and colour, then returns', async () => {
    render(<EditListScreen />);

    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe(
      'Films to watch'
    );
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'Films we love' },
    });
    fireEvent.click(screen.getByLabelText('Sky'));
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mocks.updateCollection).toHaveBeenCalledWith('shelf-1', {
        name: 'Films we love',
        color: 'sky',
      })
    );
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('keeps the draft and shows an inline error when the write fails', async () => {
    mocks.updateCollection.mockRejectedValueOnce(new Error('offline'));
    render(<EditListScreen />);

    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'Films we love' },
    });
    fireEvent.click(screen.getByLabelText('Save'));

    expect(
      await screen.findByText("Couldn't save this list. Your draft is still here.")
    ).toBeTruthy();
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe(
      'Films we love'
    );
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('honestly reports a list that is no longer there', () => {
    state.collections = [];
    render(<EditListScreen />);

    expect(screen.getByText('List not found')).toBeTruthy();
  });
});

describe('Edit list removal', () => {
  it('removes the list after a confirmation, then leaves to the shelves', async () => {
    render(<EditListScreen />);

    fireEvent.click(screen.getByText('Remove list'));
    expect(
      await screen.findByText(/This removes the list and everything in it for both of you/)
    ).toBeTruthy();
    expect(mocks.deleteCollection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Confirm remove Films to watch'));
    await waitFor(() => expect(mocks.deleteCollection).toHaveBeenCalledWith('shelf-1'));
    await waitFor(() => expect(mocks.dismissTo).toHaveBeenCalledWith('/(app)/(tabs)/ours'));
  });

  it('keeps the list when its removal fails, so it can be retried', async () => {
    mocks.deleteCollection.mockRejectedValueOnce(new Error('offline'));
    render(<EditListScreen />);

    fireEvent.click(screen.getByText('Remove list'));
    fireEvent.click(screen.getByLabelText('Confirm remove Films to watch'));

    expect(
      await screen.findByText("Couldn't remove this list. Please try again.")
    ).toBeTruthy();
    expect(mocks.dismissTo).not.toHaveBeenCalled();
  });
});
