import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { AppState } from 'react-native';

import { SomedayProvider, useSomeday } from '@/features/someday/someday-context';
import type { SomedayContextValue, SomedayItem } from '@/features/someday/types';

const fakeRepository = {
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/features/someday/local-someday-repository', () => ({
  createLocalSomedayRepository: () => fakeRepository,
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user-you', displayName: 'You', email: 'you@aoi.test' },
  }),
}));

let captured: SomedayContextValue | null = null;

function Probe() {
  captured = useSomeday();
  return null;
}

function makeItem(overrides: Partial<SomedayItem> = {}): SomedayItem {
  return {
    id: `someday_${Math.floor(Math.random() * 1000000)}`,
    title: 'A picnic on the hill',
    category: 'place',
    createdByRole: 'you',
    createdAt: '2026-07-01T10:00:00.000Z',
    checkedAt: null,
    checkedByRole: null,
    ...overrides,
  };
}

async function renderProvider() {
  const view = render(
    <SomedayProvider>
      <Probe />
    </SomedayProvider>
  );
  await waitFor(() => expect(captured?.isLoading).toBe(false));
  return view;
}

describe('SomedayProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
  });

  it('loads items and splits them into open and done, in canonical order', async () => {
    const checkedLongAgo = makeItem({
      id: 'done-old',
      title: 'Done long ago',
      checkedAt: '2026-07-02T10:00:00.000Z',
      checkedByRole: 'you',
    });
    const openOld = makeItem({ id: 'open-old', title: 'Old open', createdAt: '2026-06-01T10:00:00.000Z' });
    const openNew = makeItem({ id: 'open-new', title: 'New open', createdAt: '2026-07-10T10:00:00.000Z' });
    const checkedRecently = makeItem({
      id: 'done-new',
      title: 'Done recently',
      checkedAt: '2026-07-20T10:00:00.000Z',
      checkedByRole: 'partner',
    });

    fakeRepository.list.mockResolvedValue([checkedLongAgo, openOld, checkedRecently, openNew]);

    await renderProvider();

    expect(fakeRepository.list).toHaveBeenCalledTimes(1);
    expect(captured?.items.map((item) => item.id)).toEqual([
      'open-new',
      'open-old',
      'done-new',
      'done-old',
    ]);
    expect(captured?.openItems.map((item) => item.id)).toEqual(['open-new', 'open-old']);
    expect(captured?.doneItems.map((item) => item.id)).toEqual(['done-new', 'done-old']);
    expect(captured?.error).toBeNull();
  });

  it('surfaces a gentle error when the list cannot be loaded', async () => {
    fakeRepository.list.mockRejectedValue(new Error('network down'));

    await renderProvider();

    expect(captured?.error).toBe('Your someday list could not be loaded right now.');
    expect(captured?.items).toEqual([]);
  });

  it('addItem adds the created item to the open list', async () => {
    fakeRepository.list.mockResolvedValue([]);
    await renderProvider();

    const created = makeItem({ id: 'new-1', title: 'Tiny café', category: 'food' });
    fakeRepository.add.mockResolvedValue(created);

    await act(async () => {
      await captured?.addItem({ title: 'Tiny café', category: 'food' });
    });

    expect(fakeRepository.add).toHaveBeenCalledWith({ title: 'Tiny café', category: 'food' });
    expect(captured?.openItems.map((item) => item.id)).toEqual(['new-1']);
  });

  it('addItem rejects when the repository fails, leaving the list untouched', async () => {
    fakeRepository.list.mockResolvedValue([makeItem({ id: 'existing' })]);
    await renderProvider();

    fakeRepository.add.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await expect(captured?.addItem({ title: 'Will fail' })).rejects.toThrow();
    });

    expect(captured?.openItems.map((item) => item.id)).toEqual(['existing']);
  });

  it('setChecked(true) moves the item to done with the server\'s truth', async () => {
    const open = makeItem({ id: 's1', title: 'Night market' });
    fakeRepository.list.mockResolvedValue([open]);
    await renderProvider();

    const serverChecked: SomedayItem = {
      ...open,
      checkedAt: '2026-08-01T20:00:00.000Z',
      checkedByRole: 'you',
    };
    fakeRepository.update.mockResolvedValue(serverChecked);

    await act(async () => {
      await captured?.setChecked('s1', true);
    });

    expect(fakeRepository.update).toHaveBeenCalledWith('s1', { checked: true });
    expect(captured?.openItems).toEqual([]);
    expect(captured?.doneItems).toEqual([serverChecked]);
  });

  it('moves the item optimistically before the server answers', async () => {
    const open = makeItem({ id: 's1', title: 'Night market' });
    fakeRepository.list.mockResolvedValue([open]);
    await renderProvider();

    let resolveUpdate: ((item: SomedayItem | null) => void) | undefined;
    fakeRepository.update.mockImplementation(
      () =>
        new Promise<SomedayItem | null>((resolve) => {
          resolveUpdate = resolve;
        })
    );

    await act(async () => {
      void captured?.setChecked('s1', true);
    });

    // Optimistic: already in Done while the request is in flight.
    expect(captured?.doneItems.map((item) => item.id)).toEqual(['s1']);
    expect(captured?.doneItems[0]?.checkedByRole).toBe('you');

    const serverChecked: SomedayItem = {
      ...open,
      checkedAt: '2026-08-01T20:00:00.000Z',
      checkedByRole: 'you',
    };
    await act(async () => {
      resolveUpdate?.(serverChecked);
    });

    expect(captured?.doneItems).toEqual([serverChecked]);
  });

  it('setChecked(false) undoes a check-off and moves the item back to open', async () => {
    const done = makeItem({
      id: 's1',
      title: 'Night market',
      checkedAt: '2026-08-01T20:00:00.000Z',
      checkedByRole: 'partner',
    });
    fakeRepository.list.mockResolvedValue([done]);
    await renderProvider();

    const undone: SomedayItem = { ...done, checkedAt: null, checkedByRole: null };
    fakeRepository.update.mockResolvedValue(undone);

    await act(async () => {
      await captured?.setChecked('s1', false);
    });

    expect(fakeRepository.update).toHaveBeenCalledWith('s1', { checked: false });
    expect(captured?.doneItems).toEqual([]);
    expect(captured?.openItems).toEqual([undone]);
  });

  it('rolls back quietly when a check-off fails', async () => {
    const open = makeItem({ id: 's1', title: 'Night market' });
    fakeRepository.list.mockResolvedValue([open]);
    await renderProvider();

    fakeRepository.update.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await captured?.setChecked('s1', true);
    });

    // Tender-error policy: no drama, the item is back where it really is.
    expect(captured?.openItems).toEqual([open]);
    expect(captured?.doneItems).toEqual([]);
  });

  it('restores the original check-off when an undo fails', async () => {
    const done = makeItem({
      id: 's1',
      title: 'Night market',
      checkedAt: '2026-07-20T10:00:00.000Z',
      checkedByRole: 'partner',
    });
    fakeRepository.list.mockResolvedValue([done]);
    await renderProvider();

    fakeRepository.update.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await captured?.setChecked('s1', false);
    });

    // The inverse transition puts the item back exactly as it was.
    expect(captured?.openItems).toEqual([]);
    expect(captured?.doneItems).toEqual([done]);
  });

  it('a failed setChecked after a reload does not restore a stale snapshot', async () => {
    const openA = makeItem({ id: 'a', title: 'A', createdAt: '2026-07-01T10:00:00.000Z' });
    const openB = makeItem({ id: 'b', title: 'B', createdAt: '2026-07-02T10:00:00.000Z' });
    fakeRepository.list.mockResolvedValue([openA, openB]);
    await renderProvider();

    let rejectUpdate: ((error: Error) => void) | undefined;
    fakeRepository.update.mockImplementation(
      () =>
        new Promise<SomedayItem>((_resolve, reject) => {
          rejectUpdate = reject;
        })
    );

    // Start an optimistic check-off; the request stays in flight.
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = captured?.setChecked('a', true);
    });
    expect(captured?.doneItems.map((item) => item.id)).toEqual(['a']);

    // A focus-triggered reload lands fresh server truth: the partner added
    // "c" and "a" is still open.
    const openC = makeItem({ id: 'c', title: 'C', createdAt: '2026-07-03T10:00:00.000Z' });
    fakeRepository.list.mockResolvedValue([{ ...openA }, { ...openB }, openC]);
    await act(async () => {
      await captured?.reload();
    });
    expect(captured?.items.map((item) => item.id)).toEqual(['c', 'b', 'a']);

    // Now the in-flight check-off fails.
    await act(async () => {
      rejectUpdate?.(new Error('network down'));
      await pending;
    });

    // The fresh server state survives — no stale snapshot may replace it.
    expect(captured?.items.map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(captured?.openItems.map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(captured?.doneItems).toEqual([]);
  });

  it('a failed first setChecked cannot resurrect state over a successful second', async () => {
    const done = makeItem({
      id: 's1',
      title: 'Night market',
      checkedAt: '2026-07-20T10:00:00.000Z',
      checkedByRole: 'partner',
    });
    fakeRepository.list.mockResolvedValue([done]);
    await renderProvider();

    let rejectFirst: ((error: Error) => void) | undefined;
    const serverRechecked: SomedayItem = {
      ...done,
      checkedAt: '2026-08-02T09:00:00.000Z',
      checkedByRole: 'you',
    };
    fakeRepository.update
      // First: undo the check-off (will fail).
      .mockImplementationOnce(
        () =>
          new Promise<SomedayItem>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      // Second: re-check (succeeds with server truth).
      .mockImplementationOnce(() => Promise.resolve(serverRechecked));

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = captured?.setChecked('s1', false);
    });
    await act(async () => {
      second = captured?.setChecked('s1', true);
    });

    // The second resolves first, then the first fails — the exact order that
    // used to let the failed op's rollback resurrect stale state.
    await act(async () => {
      await second;
      rejectFirst?.(new Error('network down'));
      await first;
    });

    expect(captured?.openItems).toEqual([]);
    expect(captured?.doneItems).toEqual([serverRechecked]);
  });

  it('does not subscribe to focus changes in stub mode', async () => {
    const addEventListenerSpy = vi.spyOn(AppState, 'addEventListener');
    fakeRepository.list.mockResolvedValue([]);

    await renderProvider();

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });
});
