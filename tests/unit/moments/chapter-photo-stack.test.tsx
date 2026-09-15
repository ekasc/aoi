import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import * as Reanimated from 'react-native-reanimated';

const gestureEvents = vi.hoisted(() => ({
  update: (_event: { translationX: number }) => {},
  end: (_event: { translationX: number; velocityX: number }) => {},
  finalize: () => {},
}));

vi.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const stub = () => {
    const gesture: Record<string, unknown> = {};
    gesture.activeOffsetX = () => gesture;
    gesture.failOffsetY = () => gesture;
    gesture.onUpdate = (fn: typeof gestureEvents.update) => { gestureEvents.update = fn; return gesture; };
    gesture.onEnd = (fn: typeof gestureEvents.end) => { gestureEvents.end = fn; return gesture; };
    gesture.onFinalize = (fn: typeof gestureEvents.finalize) => { gestureEvents.finalize = fn; return gesture; };
    return gesture;
  };
  return {
    Gesture: { Pan: stub },
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    GestureDetector: ({ children }: { children?: unknown }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) => {
    const React = require('react');
    return React.createElement('button', { 'aria-label': label, onClick: onPress, style: { minHeight: 44, minWidth: 44 } }, children);
  },
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) => {
    const React = require('react');
    return React.createElement('span', null, children);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const pushSpy = vi.fn();
let searchParams: Record<string, string> = {};
let chapterMembers: Record<string, any>[] = [];

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => searchParams,
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ loadChapterRange }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { relationshipStartDate: '2024-06-15' } }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({
    serverPlus: {
      isPlus: true,
      status: 'active',
      expiresAt: null,
      mediaUsedBytes: 0,
      mediaLimitBytes: 5 * 1024 * 1024 * 1024,
      activeFutureLetters: 0,
      futureLetterLimit: null,
    },
    refreshServerPlus: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/export/keepsake-export', () => ({
  exportChapterKeepsake: async () => ({ status: 'shared' as const }),
}));

vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: ({ moment }: any) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': `chapter-member-${moment.id}` });
  },
}));

vi.mock('@/components/moments/chapter-cover', () => ({
  ChapterCover: ({ chapter }: any) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': `chapter-cover-${chapter.id}` });
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => {
    const React = require('react');
    return React.createElement('button', { onClick: onPress }, label);
  },
}));

const loadChapterRange = vi.fn(async (): Promise<Record<string, any>[]> => chapterMembers);

import {
  CHAPTER_PHOTO_STACK_HEIGHT,
  CHAPTER_PHOTO_STACK_WIDTH,
  ChapterPhotoStack,
  getChapterPhotoMoments,
} from '@/components/moments/chapter-photo-stack';

const STACK_SOURCE = readFileSync('components/moments/chapter-photo-stack.tsx', 'utf8');
const CHAPTER_SOURCE = readFileSync('app/(app)/chapter/[id].tsx', 'utf8');

function makePhoto(id: string, occurredAt: string, title?: string) {
  return {
    id,
    type: 'media' as const,
    title: title ?? `Photo ${id}`,
    body: '',
    occurredAt,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: `https://cdn.test/${id}.jpg`,
    audioUri: null,
  };
}

function makeNote(id: string, occurredAt: string) {
  return {
    id,
    type: 'note' as const,
    title: `Note ${id}`,
    body: 'words',
    occurredAt,
    createdAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    audioUri: null,
  };
}

beforeEach(() => {
  pushSpy.mockClear();
  searchParams = {};
  chapterMembers = [];
  loadChapterRange.mockReset();
  loadChapterRange.mockImplementation(async () => chapterMembers);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getChapterPhotoMoments', () => {
  it('keeps only media moments with a real preview, in chapter order', () => {
    const photoA = makePhoto('a', '2026-03-05T12:00:00.000Z');
    const note = makeNote('n', '2026-03-10T12:00:00.000Z');
    const bare = { ...makePhoto('bare', '2026-03-12T12:00:00.000Z'), mediaPreview: undefined };
    const empty = { ...makePhoto('empty', '2026-03-13T12:00:00.000Z'), mediaPreview: '' };
    const trace = { ...makeNote('v', '2026-03-14T12:00:00.000Z'), type: 'trace' as const };
    const photoB = makePhoto('b', '2026-03-15T12:00:00.000Z');

    expect(getChapterPhotoMoments([photoA, note, bare, empty, trace, photoB]).map((m) => m.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns empty for empty and photo-less chapters', () => {
    expect(getChapterPhotoMoments([])).toEqual([]);
    expect(getChapterPhotoMoments([makeNote('n', '2026-03-10T12:00:00.000Z')])).toEqual([]);
  });
});

describe('ChapterPhotoStack rendering', () => {
  it('renders nothing for empty and photo-less chapters', () => {
    const noop = vi.fn();
    const empty = render(<ChapterPhotoStack moments={[]} onOpenMoment={noop} />);
    expect(empty.container.querySelector('img')).toBeNull();
    expect(empty.container.textContent).toBe('');
    empty.unmount();

    const noPhotos = render(
      <ChapterPhotoStack moments={[makeNote('n', '2026-03-10T12:00:00.000Z')]} onOpenMoment={noop} />,
    );
    expect(noPhotos.container.querySelector('img')).toBeNull();
    expect(noPhotos.container.textContent).toBe('');
    noPhotos.unmount();
  });

  it('renders one photo with no prev/next and opens it on tap', () => {
    const photo = makePhoto('solo', '2026-03-10T12:00:00.000Z', 'Lake');
    const onOpen = vi.fn();
    const { container } = render(<ChapterPhotoStack moments={[photo]} onOpenMoment={onOpen} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/solo.jpg');
    expect(screen.queryByLabelText('Show previous photo')).toBeNull();
    expect(screen.queryByLabelText('Show next photo')).toBeNull();

    fireEvent.click(screen.getByLabelText(/open photo/i));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ id: 'solo', occurredAt: '2026-03-10T12:00:00.000Z' });
  });

  it('steps through photos with previous/next controls, wrapping at the ends', () => {
    const photos = [
      makePhoto('p1', '2026-03-05T12:00:00.000Z'),
      makePhoto('p2', '2026-03-10T12:00:00.000Z'),
      makePhoto('p3', '2026-03-15T12:00:00.000Z'),
    ];
    const onOpen = vi.fn();
    const { container } = render(<ChapterPhotoStack moments={photos} onOpenMoment={onOpen} />);

    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByLabelText(/open photo/i).querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/p1.jpg');

    act(() => {
      fireEvent.click(screen.getByLabelText('Show next photo'));
    });
    expect(screen.getByText('2 of 3')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/open photo/i));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p2' }));

    act(() => {
      fireEvent.click(screen.getByLabelText('Show next photo'));
    });
    expect(screen.getByText('3 of 3')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByLabelText('Show next photo'));
    });
    expect(screen.getByText('1 of 3')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByLabelText('Show previous photo'));
    });
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('meets the 44pt control target via the shared icon buttons', () => {
    const photos = [makePhoto('p1', '2026-03-05T12:00:00.000Z'), makePhoto('p2', '2026-03-10T12:00:00.000Z')];
    render(<ChapterPhotoStack moments={photos} onOpenMoment={vi.fn()} />);

    for (const label of ['Show previous photo', 'Show next photo']) {
      const button = screen.getByLabelText(label) as HTMLElement;
      expect(parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(button.style.minWidth)).toBeGreaterThanOrEqual(44);
    }
  });

  it('still steps instantly with no spring when reduced motion is on', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const springSpy = vi.spyOn(Reanimated, 'withSpring');
    const photos = [makePhoto('p1', '2026-03-05T12:00:00.000Z'), makePhoto('p2', '2026-03-10T12:00:00.000Z')];
    render(<ChapterPhotoStack moments={photos} onOpenMoment={vi.fn()} />);

    expect(screen.getByText('1 of 2')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByLabelText('Show next photo'));
    });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(springSpy).not.toHaveBeenCalled();
  });
});

describe('chapter stack gestures', () => {
  it('tracks a drag, cancels back home, and changes photos on a deliberate swipe', () => {
    const shared = { value: 0, set(value: number) { this.value = value; } };
    vi.spyOn(Reanimated, 'useSharedValue').mockReturnValue(shared as ReturnType<typeof Reanimated.useSharedValue>);
    render(<ChapterPhotoStack moments={[makePhoto('p1', '2026-03-05T12:00:00.000Z'), makePhoto('p2', '2026-03-10T12:00:00.000Z')]} onOpenMoment={vi.fn()} />);
    act(() => gestureEvents.update({ translationX: -25 }));
    expect(shared.value).toBe(-25);
    act(() => gestureEvents.finalize());
    expect(shared.value).toBe(0);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    act(() => gestureEvents.end({ translationX: -80, velocityX: -100 }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    act(() => gestureEvents.end({ translationX: 80, velocityX: 100 }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });
});

describe('ChapterPhotoStack motion and dependency constraints', () => {
  it('pins the small keepsake footprint that stays inside 320pt', () => {
    expect(CHAPTER_PHOTO_STACK_WIDTH).toBe(216);
    expect(CHAPTER_PHOTO_STACK_HEIGHT).toBe(270);
    expect(CHAPTER_PHOTO_STACK_WIDTH).toBeLessThanOrEqual(240);
    expect(STACK_SOURCE).toContain('maxWidth');
  });

  it('tracks the finger 1:1 and settles critically damped without bounce', () => {
    expect(STACK_SOURCE).toContain('Gesture.Pan');
    expect(STACK_SOURCE).toContain('GestureDetector');
    expect(STACK_SOURCE).toContain('activeOffsetX');
    expect(STACK_SOURCE).toContain('translationX');
    expect(STACK_SOURCE).toContain('dragX.value = event.translationX');
    expect(STACK_SOURCE).toContain('useSharedValue');
    expect(STACK_SOURCE).toContain('useAnimatedStyle');
    expect(STACK_SOURCE).toContain('withSpring');
    expect(STACK_SOURCE).toContain('damping: 32');
    expect(STACK_SOURCE).toContain('stiffness: 240');
    expect(STACK_SOURCE).not.toContain('damping: 9');
  });

  it('honours reduced motion with static rotation-free steps', () => {
    expect(STACK_SOURCE).toContain('useReducedMotion');
    expect(STACK_SOURCE).toContain('reduceMotion');
    expect(STACK_SOURCE).toContain("'0deg'");
  });

  it('uses only real photos over existing deps: no autoplay, delete, or bundled art', () => {
    expect(STACK_SOURCE).toContain('expo-image');
    expect(STACK_SOURCE).toContain('IconButton');
    expect(STACK_SOURCE).toContain('getChapterPhotoMoments');
    expect(STACK_SOURCE).not.toContain('setInterval');
    expect(STACK_SOURCE).not.toContain('setTimeout');
    expect(STACK_SOURCE).not.toContain('utoplay');
    expect(STACK_SOURCE).not.toContain('onLongPress');
    expect(STACK_SOURCE).not.toContain('removeMoment');
    expect(STACK_SOURCE).not.toContain('require(');
  });
});

describe('chapter detail photo-stack wiring', () => {
  it('keeps the archive list and routes stack taps with the occurredAt hint', () => {
    expect(CHAPTER_SOURCE).toContain('ChapterPhotoStack');
    expect(CHAPTER_SOURCE).toContain('onOpenMoment');
    expect(CHAPTER_SOURCE).toContain("pathname: '/(app)/moment/[id]'");
    expect(CHAPTER_SOURCE).toContain('at: moment.occurredAt');
    expect(CHAPTER_SOURCE).toContain('MomentCard');
    expect(CHAPTER_SOURCE).toContain('ChapterCover');
  });

  it('opens the tapped stack photo in moment detail with the correct at param', async () => {
    const photo1 = makePhoto('stack-1', '2026-03-05T12:00:00.000Z', 'First light');
    const note = makeNote('stack-note', '2026-03-10T12:00:00.000Z');
    const photo2 = makePhoto('stack-2', '2026-03-15T12:00:00.000Z', 'Second light');
    chapterMembers = [photo1, note, photo2];
    searchParams = { id: 'month:2026-03' };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);

    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/open photo/i));
    });
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'stack-1', at: '2026-03-05T12:00:00.000Z' },
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Show next photo'));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/open photo/i));
    });
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'stack-2', at: '2026-03-15T12:00:00.000Z' },
    });
  });
});
