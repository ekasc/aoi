import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Alert, Linking } from 'react-native';

import NewItemScreen from '@/app/(app)/collection/[id]/item/new';
import EditItemScreen from '@/app/(app)/collection/[id]/item/[itemId]';
import type { CollectionItem } from '@/features/collections/types';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const params = vi.hoisted(() => ({
  id: 'shelf-1' as string | undefined,
  itemId: 'item-1' as string | undefined,
}));

vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({
    listItems: mocks.listItems,
    createItem: mocks.createItem,
    updateItem: mocks.updateItem,
    deleteItem: mocks.deleteItem,
  }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back }),
  useLocalSearchParams: () => ({ ...params }),
  Stack: { Screen: () => null },
}));

// The cover picker reaches for the native library; no test opens it.
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));


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
  params.id = 'shelf-1';
  params.itemId = 'item-1';
  mocks.listItems.mockResolvedValue([makeItem()]);
  mocks.createItem.mockImplementation(async (collectionId, input) =>
    makeItem({ id: 'created', collectionId, ...input })
  );
  mocks.updateItem.mockImplementation(async (itemId, input) =>
    makeItem({ id: itemId, ...input })
  );
  mocks.deleteItem.mockResolvedValue(undefined);
});

describe('Add a thing', () => {
  it('adds what you gave it, then returns to the list', async () => {
    render(<NewItemScreen />);

    fireEvent.change(screen.getByLabelText('Item title'), {
      target: { value: 'Perfect Days' },
    });
    fireEvent.change(screen.getByLabelText('Item note'), { target: { value: 'quiet' } });
    fireEvent.change(screen.getByLabelText('Item link'), {
      target: { value: 'https://example.com/pd' },
    });
    fireEvent.click(screen.getByLabelText('Add'));

    await waitFor(() =>
      expect(mocks.createItem).toHaveBeenCalledWith('shelf-1', {
        title: 'Perfect Days',
        note: 'quiet',
        link: 'https://example.com/pd',
        coverUrl: null,
        status: null,
        score: null,
      })
    );
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('records a status and a score with the thing', async () => {
    render(<NewItemScreen />);

    fireEvent.change(screen.getByLabelText('Item title'), {
      target: { value: 'Perfect Days' },
    });
    fireEvent.change(screen.getByLabelText('Item status'), { target: { value: 'done' } });
    fireEvent.change(screen.getByLabelText('Item score'), { target: { value: '9' } });
    fireEvent.click(screen.getByLabelText('Add'));

    await waitFor(() =>
      expect(mocks.createItem).toHaveBeenCalledWith(
        'shelf-1',
        expect.objectContaining({ status: 'done', score: 9 })
      )
    );
  });

  it('keeps the draft and shows an inline error when the write fails', async () => {
    mocks.createItem.mockRejectedValueOnce(new Error('offline'));
    render(<NewItemScreen />);

    fireEvent.change(screen.getByLabelText('Item title'), {
      target: { value: 'Perfect Days' },
    });
    fireEvent.click(screen.getByLabelText('Add'));

    expect(
      await screen.findByText("Couldn't save this thing. Your draft is still here.")
    ).toBeTruthy();
    expect((screen.getByLabelText('Item title') as HTMLInputElement).value).toBe(
      'Perfect Days'
    );
    expect(mocks.back).not.toHaveBeenCalled();
  });
});

describe('A thing’s own page', () => {
  it('loads the thing and saves the change', async () => {
    render(<EditItemScreen />);

    await waitFor(() =>
      expect((screen.getByLabelText('Edit title') as HTMLInputElement).value).toBe(
        'Spirited Away'
      )
    );
    fireEvent.change(screen.getByLabelText('Edit title'), {
      target: { value: 'Spirited' },
    });
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mocks.updateItem).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ title: 'Spirited' })
      )
    );
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('retains the selected status and score when chosen again', async () => {
    mocks.listItems.mockResolvedValue([makeItem({ status: 'done', score: 9 })]);
    render(<EditItemScreen />);
    await screen.findByLabelText('Edit status');
    fireEvent.change(screen.getByLabelText('Edit status'), { target: { value: 'done' } });
    fireEvent.change(screen.getByLabelText('Edit score'), { target: { value: '9' } });
    fireEvent.click(screen.getByLabelText('Save'));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith(
      'item-1', expect.objectContaining({ status: 'done', score: 9 })
    ));
  });

  it('clears a status and score through explicit menu choices', async () => {
    mocks.listItems.mockResolvedValue([makeItem({ status: 'done', score: 9 })]);
    render(<EditItemScreen />);

    await screen.findByLabelText('Edit status');
    // Both were selected; choosing each again unsets it.
    fireEvent.change(screen.getByLabelText('Edit status'), { target: { value: 'none' } });
    fireEvent.change(screen.getByLabelText('Edit score'), { target: { value: 'unrated' } });
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mocks.updateItem).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ status: null, score: null })
      )
    );
  });

  it('opens an http(s) link externally and renders a place as plain text', async () => {
    mocks.listItems.mockResolvedValue([
      makeItem({ id: 'url', title: 'A URL', link: 'https://example.com/pd' }),
    ]);
    params.itemId = 'url';
    const { unmount } = render(<EditItemScreen />);

    const link = await screen.findByLabelText('Open link: https://example.com/pd');
    fireEvent.click(link);
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/pd');
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    unmount();

    // The place string is shown as text, never dressed up as a link.
    mocks.listItems.mockResolvedValue([
      makeItem({ id: 'place', title: 'A place', link: 'The café on 3rd' }),
    ]);
    params.itemId = 'place';
    render(<EditItemScreen />);

    expect(await screen.findByText('The café on 3rd')).toBeTruthy();
    expect(screen.queryByLabelText('Open link: The café on 3rd')).toBeNull();
  });

  it('confirms before removing a thing, then returns to the list', async () => {
    render(<EditItemScreen />);

    await waitFor(() => expect(screen.getByLabelText('Remove from list')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Remove from list'));
    expect(mocks.deleteItem).not.toHaveBeenCalled();

    const choices = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    choices?.find((choice) => choice.style === 'destructive')?.onPress?.();

    await waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledWith('shelf-1', 'item-1'));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
  });

  it('keeps the item when native removal confirmation is cancelled', async () => {
    render(<EditItemScreen />);
    await screen.findByLabelText('Remove from list');
    fireEvent.click(screen.getByLabelText('Remove from list'));
    const choices = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    expect(choices?.some((choice) => choice.style === 'cancel')).toBe(true);
    choices?.find((choice) => choice.style === 'cancel')?.onPress?.();
    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('honestly reports a thing that is no longer in the list', async () => {
    mocks.listItems.mockResolvedValue([]);
    render(<EditItemScreen />);

    expect(await screen.findByText('Not here any more')).toBeTruthy();
  });
});
