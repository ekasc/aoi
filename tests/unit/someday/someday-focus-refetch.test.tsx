import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { AppState } from 'react-native';

import { SomedayProvider, useSomeday } from '@/features/someday/someday-context';
import type { SomedayContextValue, SomedayItem } from '@/features/someday/types';

// Remote-mode provider: stub mode is forced off so the focus listener is
// registered, and the remote repository is faked.
const mockRemoteRepository = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
}));

vi.mock('@/features/someday/remote-someday-repository', () => ({
  remoteSomedayRepository: mockRemoteRepository,
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

describe('SomedayProvider focus refetch (remote mode)', () => {
  let focusListener: ((nextAppState: string) => void) | undefined;
  let removeListener: (() => void) | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
    focusListener = undefined;
    removeListener = vi.fn();

    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      focusListener = handler as (nextAppState: string) => void;
      return { remove: () => removeListener?.() };
    });
  });

  async function renderProvider() {
    const view = render(
      <SomedayProvider>
        <Probe />
      </SomedayProvider>
    );
    await waitFor(() => expect(captured?.isLoading).toBe(false));
    return view;
  }

  it('reloads the list when the app returns to focus', async () => {
    const openMine = makeItem({ id: 'mine', title: 'My idea' });
    mockRemoteRepository.list.mockResolvedValueOnce([openMine]);

    await renderProvider();
    expect(mockRemoteRepository.list).toHaveBeenCalledTimes(1);
    expect(focusListener).toBeDefined();

    // The partner added something while the app was backgrounded.
    const openTheirs = makeItem({
      id: 'theirs',
      title: 'Partner idea',
      createdByRole: 'partner',
      createdAt: '2026-07-05T10:00:00.000Z',
    });
    mockRemoteRepository.list.mockResolvedValueOnce([openMine, openTheirs]);

    await act(async () => {
      focusListener?.('active');
    });

    await waitFor(() =>
      expect(captured?.items.map((item) => item.id)).toEqual(['theirs', 'mine'])
    );
    expect(mockRemoteRepository.list).toHaveBeenCalledTimes(2);
  });

  it('ignores non-active app-state transitions', async () => {
    mockRemoteRepository.list.mockResolvedValue([makeItem({ id: 'mine' })]);

    await renderProvider();
    expect(mockRemoteRepository.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusListener?.('background');
      focusListener?.('inactive');
    });

    expect(mockRemoteRepository.list).toHaveBeenCalledTimes(1);
  });

  it('removes the focus subscription on unmount', async () => {
    mockRemoteRepository.list.mockResolvedValue([makeItem({ id: 'mine' })]);

    const view = await renderProvider();
    expect(focusListener).toBeDefined();

    view.unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
