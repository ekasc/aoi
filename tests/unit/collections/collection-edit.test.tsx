import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { Collection } from '@/features/collections/types';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  updateCollection: vi.fn(),
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
  }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back }),
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
