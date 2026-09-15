import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { createElement } from 'react';

function baseMoment(overrides: Record<string, string | boolean | null> = {}) {
  return {
    id: 'm-1',
    type: 'note',
    title: 'Kept title',
    body: 'Kept body',
    occurredAt: '2024-05-10T12:00:00.000Z',
    targetAt: null,
    createdAt: '2024-05-10T12:00:00.000Z',
    updatedAt: '2024-05-10T12:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    isOwn: true,
    mediaPreview: undefined,
    audioUri: null,
    mediaId: null,
    ...overrides,
  };
}

// ── Detail screen suite ──────────────────────────────────────────────
let detailMoments: ReturnType<typeof baseMoment>[] = [];
let detailParams: Record<string, string | undefined> = {};
const detailLoadChapterRange = vi.fn();
const detailPush = vi.fn();
const detailBack = vi.fn();
const detailDismissTo = vi.fn();
const detailRemoveMoment = vi.fn();

vi.mock('expo-router', () => {
  const React = require('react');
  return {
    Stack: { Screen: () => null },
    useRouter: () => ({ push: detailPush, back: detailBack, dismissTo: detailDismissTo }),
    useLocalSearchParams: () => detailParams,
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => {
        (globalThis as any).__detailFocus = effect;
        return effect();
      }, []);
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: detailMoments,
    isLoading: false,
    loadChapterRange: detailLoadChapterRange,
    removeMoment: detailRemoveMoment,
  }),
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible, title, description, actions }: { visible: boolean; title?: string; description?: string; actions: { label: string; onPress: () => void }[] }) => {
    if (!visible) return null;
    return createElement(
      'div',
      { 'data-testid': `sheet:${title ?? 'untitled'}` },
      description ? createElement('span', {}, description) : null,
      ...actions.map((action) => createElement('button', { key: action.label, onClick: action.onPress }, action.label)),
    );
  },
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement('button', { onClick: onPress }, label),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) => createElement('div', {}, children),
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: ({ uri }: { uri: string }) => createElement('div', { 'data-testid': 'audio' }, uri),
}));

async function renderDetail() {
  const { default: Detail } = await import('@/app/(app)/moment/[id]');
  return render(createElement(Detail));
}

function triggerRefocus() {
  const effect = (globalThis as any).__detailFocus as (() => void) | undefined;
  act(() => {
    effect?.();
  });
}

describe('Moment read detail', () => {
  beforeEach(() => {
    detailMoments = [];
    detailParams = {};
    detailLoadChapterRange.mockReset();
    detailLoadChapterRange.mockResolvedValue([]);
    detailPush.mockClear();
    detailBack.mockClear();
    detailDismissTo.mockClear();
    detailRemoveMoment.mockReset();
    detailRemoveMoment.mockResolvedValue(undefined);
    (globalThis as any).__detailFocus = undefined;
  });

  it('shows an owner-only Edit affordance for an own moment', async () => {
    detailMoments = [baseMoment({ isOwn: true })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    expect(screen.getByText('Kept title')).toBeTruthy();
    expect(screen.getByText('Kept body')).toBeTruthy();
    fireEvent.click(screen.getByText('Edit'));
    expect(detailPush).toHaveBeenCalledWith({
      pathname: '/(app)/moment/edit/[id]',
      params: { id: 'm-1', at: '2024-05-10T12:00:00.000Z' },
    });
  });

  it('hides Edit for a partner moment and still reads content', async () => {
    detailMoments = [baseMoment({ authorRole: 'partner', authorName: 'Alex', isOwn: false })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    expect(screen.getByText('Kept title')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();
  });

  it('shows not-found when the moment is gone', async () => {
    detailMoments = [];
    detailParams = { id: 'missing' };
    await renderDetail();
    await waitFor(() => expect(screen.getByText('This memory is no longer available')).toBeTruthy());
  });

  it('reports loading — not missing — on first render with a day hint', async () => {
    detailMoments = [];
    let resolveLoad: ((value: unknown[]) => void) | null = null;
    detailLoadChapterRange.mockImplementationOnce(
      () => new Promise<unknown[]>((resolve) => { resolveLoad = resolve; }),
    );
    detailParams = { id: 'old-9', at: '2022-03-04T15:00:00.000Z' };
    await renderDetail();
    expect(screen.getByText('Opening this memory…')).toBeTruthy();
    expect(screen.queryByText('This memory is no longer available')).toBeNull();
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveLoad?.([]);
    });
    await waitFor(() => expect(screen.getByText('This memory is no longer available')).toBeTruthy());
  });

  it('resolves an old chapter entry with one bounded day-range load', async () => {
    const old = baseMoment({ id: 'old-9', occurredAt: '2022-03-04T15:00:00.000Z' });
    detailMoments = [];
    detailLoadChapterRange.mockResolvedValue([old]);
    detailParams = { id: 'old-9', at: '2022-03-04T15:00:00.000Z' };
    await renderDetail();
    await waitFor(() => expect(screen.getByText('Kept title')).toBeTruthy());
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(1);
    const fromMs = detailLoadChapterRange.mock.calls[0][0];
    const toMs = detailLoadChapterRange.mock.calls[0][1];
    const dayStart = new Date(fromMs);
    const dayEnd = new Date(toMs);
    expect(dayStart.getHours()).toBe(0);
    expect(dayStart.getMinutes()).toBe(0);
    expect(dayEnd.getHours()).toBe(0);
    // No full-content params were needed — id + day hint only.
    expect(detailParams).toEqual({ id: 'old-9', at: '2022-03-04T15:00:00.000Z' });
  });

  it('mounts with a single bounded fetch — focus does not double-fetch', async () => {
    const old = baseMoment({ id: 'old-9', occurredAt: '2022-03-04T15:00:00.000Z' });
    detailMoments = [];
    detailLoadChapterRange.mockResolvedValue([old]);
    detailParams = { id: 'old-9', at: '2022-03-04T15:00:00.000Z' };
    await renderDetail();
    await waitFor(() => expect(screen.getByText('Kept title')).toBeTruthy());
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(1);
  });

  it('refocus refreshes the bounded read so an edit never shows stale', async () => {
    const before = baseMoment({ id: 'old-9', title: 'Before edit', occurredAt: '2022-03-04T15:00:00.000Z' });
    const after = baseMoment({ id: 'old-9', title: 'After edit', occurredAt: '2022-03-04T15:00:00.000Z' });
    detailMoments = [];
    detailLoadChapterRange.mockResolvedValueOnce([before]);
    detailParams = { id: 'old-9', at: '2022-03-04T15:00:00.000Z' };
    await renderDetail();
    await waitFor(() => expect(screen.getByText('Before edit')).toBeTruthy());
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(1);

    detailLoadChapterRange.mockResolvedValueOnce([after]);
    triggerRefocus();
    await waitFor(() => expect(screen.getByText('After edit')).toBeTruthy());
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Before edit')).toBeNull();
  });

  it('a failed load shows a distinct title and retry recovers', async () => {
    const old = baseMoment({ id: 'old-9', occurredAt: '2022-03-04T15:00:00.000Z' });
    detailMoments = [];
    detailLoadChapterRange.mockRejectedValueOnce(new Error('backend exploded'));
    detailParams = { id: 'old-9', at: '2022-03-04T15:00:00.000Z' };
    await renderDetail();
    await waitFor(() => expect(screen.getByText('Could not load this memory')).toBeTruthy());
    // Never leak backend verbatim into the UI.
    expect(screen.queryByText('backend exploded')).toBeNull();
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(1);

    detailLoadChapterRange.mockResolvedValueOnce([old]);
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });
    await waitFor(() => expect(screen.getByText('Kept title')).toBeTruthy());
    expect(detailLoadChapterRange).toHaveBeenCalledTimes(2);
  });

  it('changing ids never serves the previous id’s error', async () => {
    detailMoments = [];
    detailLoadChapterRange.mockRejectedValueOnce(new Error('nope'));
    detailParams = { id: 'gone-a', at: '2022-03-04T15:00:00.000Z' };
    const rendered = await renderDetail();
    await waitFor(() => expect(screen.getByText('Could not load this memory')).toBeTruthy());

    const found = baseMoment({ id: 'found-b', occurredAt: '2022-03-04T15:00:00.000Z' });
    detailLoadChapterRange.mockResolvedValueOnce([found]);
    detailParams = { id: 'found-b', at: '2022-03-04T15:00:00.000Z' };
    rendered.rerender(createElement((await import('@/app/(app)/moment/[id]')).default));
    await waitFor(() => expect(screen.getByText('Kept title')).toBeTruthy());
    expect(screen.queryByText('Could not load this memory')).toBeNull();
  });

  it('renders photos full-width contain, never cropped', async () => {
    detailMoments = [baseMoment({ type: 'media', mediaPreview: 'https://cdn.test/full.jpg' })];
    detailParams = { id: 'm-1' };
    const { container } = await renderDetail();
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.test/full.jpg');
    expect(image?.getAttribute('contentfit')).toBe('contain');
  });
});

describe('Moment detail ownership + deletion (overflow)', () => {
  beforeEach(() => {
    detailMoments = [];
    detailParams = {};
    detailLoadChapterRange.mockReset();
    detailLoadChapterRange.mockResolvedValue([]);
    detailPush.mockClear();
    detailBack.mockClear();
    detailDismissTo.mockClear();
    detailRemoveMoment.mockReset();
    detailRemoveMoment.mockResolvedValue(undefined);
  });

  it('shows owner-only More actions and hides it for partner moments', async () => {
    detailMoments = [baseMoment({ isOwn: true })];
    detailParams = { id: 'm-1' };
    const view = await renderDetail();
    expect(screen.getByText('More actions')).toBeTruthy();
    view.unmount();

    detailMoments = [baseMoment({ authorRole: 'partner', authorName: 'Alex', isOwn: false })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    expect(screen.queryByText('More actions')).toBeNull();
  });

  it('overflow exposes Edit with existing edit semantics', async () => {
    detailMoments = [baseMoment({ isOwn: true })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    fireEvent.click(screen.getByText('More actions'));
    fireEvent.click(screen.getByTestId('sheet:Kept title').querySelector('button') as HTMLElement);
    // First action in the overflow is Edit — same destination as the inline Edit.
    expect(detailPush).toHaveBeenCalledWith({
      pathname: '/(app)/moment/edit/[id]',
      params: { id: 'm-1', at: '2024-05-10T12:00:00.000Z' },
    });
  });

  it('delete confirms with Memories copy, removes, then goes back only on success', async () => {
    detailMoments = [baseMoment({ isOwn: true })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    fireEvent.click(screen.getByText('More actions'));
    const overflow = screen.getByTestId('sheet:Kept title');
    const deleteBtn = Array.from(overflow.querySelectorAll('button')).find((el) => el.textContent === 'Delete') as HTMLElement;
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(screen.getByTestId('sheet:Remove this moment?')).toBeTruthy());
    expect(screen.getByText('This moment will be removed from your shared timeline')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Remove'));
    });
    await waitFor(() => expect(detailRemoveMoment).toHaveBeenCalledWith('m-1'));
    await waitFor(() => expect(detailBack).toHaveBeenCalledTimes(1));
  });

  it('delete failure shows an explicit error and stays without navigating', async () => {
    detailRemoveMoment.mockRejectedValueOnce(new Error('backend down'));
    detailMoments = [baseMoment({ isOwn: true })];
    detailParams = { id: 'm-1' };
    await renderDetail();
    fireEvent.click(screen.getByText('More actions'));
    const overflow = screen.getByTestId('sheet:Kept title');
    const deleteBtn = Array.from(overflow.querySelectorAll('button')).find((el) => el.textContent === 'Delete') as HTMLElement;
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(screen.getByTestId('sheet:Remove this moment?')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('Remove'));
    });
    await waitFor(() => expect(screen.getByText("Couldn't remove this moment right now. Try again?")).toBeTruthy());
    expect(detailBack).not.toHaveBeenCalled();
    expect(detailDismissTo).not.toHaveBeenCalled();
  });
});

describe('dayBounds (local DST days)', () => {
  it('spans the spring-forward day at 23 hours, midnight to midnight', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { dayBounds } = await import('@/features/moments/use-moment');
      const atMs = new Date('2025-03-09T12:00:00-07:00').getTime();
      const { fromMs, toMs } = dayBounds(atMs);
      const from = new Date(fromMs);
      const to = new Date(toMs);
      expect(from.getHours()).toBe(0);
      expect(from.getMinutes()).toBe(0);
      expect(to.getHours()).toBe(0);
      expect(to.getMinutes()).toBe(0);
      expect(to.getDate()).not.toBe(from.getDate());
      expect(toMs - fromMs).toBe(23 * 60 * 60 * 1000);
    } finally {
      if (previousTz === undefined) delete (process.env as Record<string, string | undefined>).TZ;
      else process.env.TZ = previousTz;
    }
  });

  it('spans the fall-back day at 25 hours, midnight to midnight', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { dayBounds } = await import('@/features/moments/use-moment');
      const atMs = new Date('2025-11-02T12:00:00-08:00').getTime();
      const { fromMs, toMs } = dayBounds(atMs);
      expect(new Date(fromMs).getHours()).toBe(0);
      expect(new Date(toMs).getHours()).toBe(0);
      expect(toMs - fromMs).toBe(25 * 60 * 60 * 1000);
    } finally {
      if (previousTz === undefined) delete (process.env as Record<string, string | undefined>).TZ;
      else process.env.TZ = previousTz;
    }
  });
});
