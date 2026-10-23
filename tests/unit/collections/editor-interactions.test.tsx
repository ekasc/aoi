import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ComponentProps } from 'react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditListScreen from '@/app/(app)/collection/[id]/edit';
import EditItemScreen from '@/app/(app)/collection/[id]/item/[itemId]';
import NewItemScreen from '@/app/(app)/collection/[id]/item/new';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  dismissTo: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  listItems: vi.fn(),
  presses: new Map<string, () => void>(),
  focus: undefined as (() => void) | undefined,
  blur: undefined as (() => void) | undefined,
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => useEffect(() => {
    mocks.focus = () => { mocks.blur = effect() ?? undefined; };
    mocks.focus();
    return () => {
      mocks.blur?.();
      mocks.focus = undefined;
      mocks.blur = undefined;
    };
  }, [effect]),
  useRouter: () => ({ back: mocks.back, dismissTo: mocks.dismissTo }),
  useLocalSearchParams: () => ({ id: 'shelf-1', itemId: 'item-1' }),
  Stack: { Screen: () => null },
}));
vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({
    ...mocks,
    isLoading: false,
    collections: [{ id: 'shelf-1', name: 'Films', color: null }],
  }),
}));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));
vi.mock('@/components/media/cover-picker', () => ({ CoverPicker: () => null }));

// Capture the callback before a render can replace it with a disabled control.
vi.mock('@/components/ui/expo-controls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/expo-controls')>();
  return {
    ...actual,
    ExpoButton: (props: ComponentProps<typeof actual.ExpoButton>) => {
      mocks.presses.set(props.accessibilityLabel ?? props.label, props.onPress);
      return <actual.ExpoButton {...props} />;
    },
  };
});
vi.mock('@/components/ui/button', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/button')>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      mocks.presses.set(props.accessibilityLabel ?? props.label, props.onPress);
      return <actual.Button {...props} />;
    },
  };
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function press(label: string) {
  const callback = mocks.presses.get(label);
  if (!callback) throw new Error(`Missing action: ${label}`);
  return callback;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.presses.clear();
  mocks.listItems.mockResolvedValue([{
    id: 'item-1', collectionId: 'shelf-1', title: 'Film',
    note: null, link: null, coverUrl: null, status: null, score: null,
  }]);
  for (const mutation of [mocks.createItem, mocks.updateItem, mocks.deleteItem, mocks.updateCollection, mocks.deleteCollection]) {
    mutation.mockResolvedValue(undefined);
  }
});

const editors = [
  { name: 'new item', Screen: NewItemScreen, field: 'Item title', action: 'Add', mutation: mocks.createItem },
  { name: 'edit item', Screen: EditItemScreen, field: 'Edit title', action: 'Save', mutation: mocks.updateItem },
  { name: 'edit list', Screen: EditListScreen, field: 'List name', action: 'Save', mutation: mocks.updateCollection },
];

describe.each(editors)('$name submission', ({ Screen, field, action, mutation }) => {
  it('submits only once when the same callback fires twice before React commits', async () => {
    const pending = deferred();
    mutation.mockReturnValue(pending.promise);
    render(<Screen />);
    fireEvent.change(await screen.findByLabelText(field), { target: { value: 'My draft' } });
    const submit = press(action);
    act(() => { submit(); submit(); });
    expect(mutation).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it('preserves a failed draft and unlocks submission for retry', async () => {
    mutation.mockRejectedValueOnce(new Error('offline'));
    render(<Screen />);
    fireEvent.change(await screen.findByLabelText(field), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByLabelText(action));
    await screen.findByText(/Couldn't save this .* Your draft is still here\./);
    expect(mocks.back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(action));
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
    expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[0]);
    expect(mutation.mock.calls[1]?.[1]).toEqual(expect.objectContaining(
      field === 'List name' ? { name: 'My draft' } : { title: 'My draft' }
    ));
    await waitFor(() => expect(mocks.back).toHaveBeenCalledTimes(1));
  });

  it('does not navigate when a save completes after unmount', async () => {
    const pending = deferred();
    mutation.mockReturnValue(pending.promise);
    const { unmount } = render(<Screen />);
    fireEvent.change(await screen.findByLabelText(field), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByLabelText(action));
    expect(mutation).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not navigate after losing focus, even if refocused: %s', async (refocus) => {
    const pending = deferred();
    mutation.mockReturnValue(pending.promise);
    render(<Screen />);
    fireEvent.change(await screen.findByLabelText(field), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByLabelText(action));
    expect(mutation).toHaveBeenCalledTimes(1);
    act(() => { mocks.blur?.(); if (refocus) mocks.focus?.(); });
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('preserves a write rejected while blurred and allows retry after refocus', async () => {
    const pending = deferred();
    mutation.mockReturnValueOnce(pending.promise);
    render(<Screen />);
    fireEvent.change(await screen.findByLabelText(field), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByLabelText(action));
    act(() => { mocks.blur?.(); });
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => {}); });
    expect(mocks.back).not.toHaveBeenCalled();
    act(() => { mocks.focus?.(); });
    fireEvent.click(screen.getByLabelText(action));
    await waitFor(() => expect(mocks.back).toHaveBeenCalledTimes(1));
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[0]);
  });
});

const removals = [
  {
    name: 'item', Screen: EditItemScreen, mutation: mocks.deleteItem,
    confirm: async () => {
      fireEvent.click(await screen.findByLabelText('Remove from list'));
      const callback = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((choice) => choice.style === 'destructive')?.onPress;
      if (!callback) throw new Error('Missing removal confirmation');
      return callback;
    },
    navigation: mocks.back,
  },
  {
    name: 'list', Screen: EditListScreen, mutation: mocks.deleteCollection,
    confirm: async () => {
      fireEvent.click(screen.getByLabelText('Remove list'));
      return press('Confirm remove Films');
    },
    navigation: mocks.dismissTo,
  },
];

describe.each(removals)('$name removal', ({ Screen, mutation, confirm, navigation }) => {
  it('deduplicates the confirmation callback before React commits', async () => {
    const pending = deferred();
    mutation.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    render(<Screen />);
    const remove = await confirm();
    act(() => { remove(); remove(); });
    expect(mutation).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(navigation).toHaveBeenCalledTimes(1);
  });

  it('unlocks a failed removal for retry', async () => {
    mutation.mockRejectedValueOnce(new Error('offline'));
    render(<Screen />);
    const remove = await confirm();
    await act(async () => { remove(); });
    expect(navigation).not.toHaveBeenCalled();
    await act(async () => { remove(); });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(navigation).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when removal completes after unmount', async () => {
    const pending = deferred();
    mutation.mockReturnValue(pending.promise);
    const { unmount } = render(<Screen />);
    const remove = await confirm();
    act(() => { remove(); });
    unmount();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(navigation).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not navigate after losing focus, even if refocused: %s', async (refocus) => {
    const pending = deferred();
    mutation.mockReturnValue(pending.promise);
    render(<Screen />);
    const remove = await confirm();
    act(() => { remove(); });
    expect(mutation).toHaveBeenCalledTimes(1);
    act(() => { mocks.blur?.(); if (refocus) mocks.focus?.(); });
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(navigation).not.toHaveBeenCalled();
  });

  it('allows removal retry after a failure while blurred', async () => {
    const pending = deferred();
    mutation.mockReturnValueOnce(pending.promise);
    render(<Screen />);
    const remove = await confirm();
    act(() => { remove(); mocks.blur?.(); });
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => {}); });
    expect(navigation).not.toHaveBeenCalled();
    act(() => { mocks.focus?.(); });
    await act(async () => { remove(); });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(navigation).toHaveBeenCalledTimes(1);
  });
});
