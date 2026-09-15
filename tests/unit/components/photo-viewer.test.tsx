import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';

type TestProps = {
  children?: ReactNode;
  style?: unknown;
  [key: string]: unknown;
};

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    const merged: Record<string, unknown> = {};
    for (const entry of style) {
      const flat = flattenStyle(entry);
      if (flat && typeof flat === 'object') {
        Object.assign(merged, flat);
      }
    }
    return merged;
  }
  return typeof style === 'object' && style !== null
    ? (style as Record<string, unknown>)
    : {};
}

let capturedList: any = null;

vi.mock('react-native', () => {
  const View = ({ children, style, ...rest }: TestProps) =>
    createElement('div', { style: flattenStyle(style), ...rest }, children);

  const Text = ({ children, style, ...rest }: TestProps) =>
    createElement('span', { style: flattenStyle(style), ...rest }, children);

  const Pressable = ({ children, style, onPress, accessibilityLabel }: TestProps) =>
    createElement(
      'div',
      {
        style: flattenStyle(style),
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        onClick: onPress,
      },
      children
    );

  const Modal = ({ children }: TestProps) => createElement('div', {}, children);

  const FlatList = (props: any) => {
    capturedList = props;
    return createElement(
      'div',
      { 'data-testid': 'viewer-list' },
      (props.data ?? []).map((item: any, index: number) =>
        createElement('div', { key: `${item.uri}:${index}` }, props.renderItem({ item, index }))
      )
    );
  };

  return {
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
    },
    View,
    Text,
    Pressable,
    Modal,
    FlatList,
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-image', () => ({
  Image: ({ source, accessibilityLabel }: any) =>
    createElement('img', { src: source?.uri, 'aria-label': accessibilityLabel }),
}));

const capturedZoomProps: any[] = [];

vi.mock('@/components/moments/zoomable-photo', () => ({
  OPEN_EASING: {},
  OPEN_MORPH_DELAY: 16,
  OPEN_MORPH_DURATION: 300,
  backdropFor: (t: number) => 1 - t,
  // Keeps the photo in the tree (the img assertions) and captures the
  // pager-lock reports and morph requests the viewer wires. The real photo
  // animates home on morphOut and only then calls onDismiss; the tests call
  // that themselves so the ordering is asserted, not assumed.
  ZoomablePhoto: (props: any) => {
    capturedZoomProps.push(props);
    return createElement('img', {
      src: props.uri,
      'aria-label': props.label,
      'data-testid': 'zoomable-photo',
    });
  },
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) =>
    createElement('button', { onClick: onPress, 'aria-label': label }, label),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ accessibilityLabel, label, onPress, children }: any) =>
    createElement(
      'button',
      { onClick: onPress, 'aria-label': accessibilityLabel ?? label },
      children
    ),
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => <span />,
}));

const capturedMediaPages: { video: any[]; voice: any[] } = { video: [], voice: [] };

vi.mock('@/components/moments/viewer-media-page', () => ({
  ViewerVideoPage: (props: any) => {
    capturedMediaPages.video.push(props);
    return createElement('div', { 'data-testid': 'video-page' });
  },
  ViewerVoicePage: (props: any) => {
    capturedMediaPages.voice.push(props);
    return createElement('div', { 'data-testid': 'voice-page' });
  },
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

const mediaCloseSpy = vi.fn();

// The media pages' close is a shrink-and-fade that owns its own completion
// (covered by viewer-media-dismiss's contract test); this file checks that the
// session routes a clip or a voice note through it instead of closing flat.
vi.mock('@/components/moments/viewer-media-dismiss', () => ({
  MEDIA_DISMISS_SHRINK: 0.14,
  useMediaDismiss: () => ({ gesture: {}, style: {} }),
  useMediaCloseAnimation: () => mediaCloseSpy,
}));

const PHOTOS: ViewerPhoto[] = [
  { uri: 'file:///one.jpg', label: 'Lake day', momentId: 'm-1' },
  { uri: 'file:///two.jpg', label: 'Lake day', momentId: 'm-1' },
  { uri: 'file:///three.jpg', label: 'Lake day', momentId: 'm-1' },
];

const FIVE: ViewerPhoto[] = [
  ...PHOTOS,
  { uri: 'file:///four.jpg', label: 'Lake day', momentId: 'm-1' },
  { uri: 'file:///five.jpg', label: 'Lake day', momentId: 'm-1' },
];

/** A second gallery: different owning memory, different photos. */
const OTHER_SET: ViewerPhoto[] = [
  { uri: 'file:///trip-a.jpg', label: 'Trip', momentId: 'm-2' },
  { uri: 'file:///trip-b.jpg', label: 'Trip', momentId: 'm-2' },
];

function renderViewer(props?: Partial<React.ComponentProps<typeof PhotoViewer>>) {
  return render(
    <PhotoViewer
      visible
      photos={PHOTOS}
      initialIndex={0}
      onClose={() => {}}
      onOpenMemory={() => {}}
      {...props}
    />
  );
}

beforeEach(() => {
  capturedZoomProps.length = 0;
  capturedMediaPages.video.length = 0;
  capturedMediaPages.voice.length = 0;
});

/**
 * The Gallery's album: the same viewer, but its set is the whole wall, so a
 * swipe lands on the next piece of media whatever kind it is. The Feed never
 * builds a set like this — it pages one memory's photos — so nothing here
 * reaches the feed.
 */
const MIXED: ViewerPhoto[] = [
  { kind: 'photo', uri: 'file:///a.jpg', label: 'Lake day', momentId: 'm-1' },
  {
    kind: 'video',
    uri: 'https://cdn.test/clip.mp4',
    posterUri: 'file:///poster.jpg',
    label: 'Beach dog',
    momentId: 'm-1',
  },
  {
    kind: 'voice',
    uri: 'file:///note.m4a',
    label: 'Voice note (1 of 3)',
    momentId: 'm-1',
    seed: 'm-1:audio',
  },
];

describe('PhotoViewer across media kinds', () => {
  it('opens a clip full screen, and names it in the counter', () => {
    renderViewer({ photos: MIXED, initialIndex: 1 });
    expect(screen.getByTestId('video-page')).toBeTruthy();
    expect(screen.getByText('Video 2 of 3')).toBeTruthy();
    expect(capturedMediaPages.video[0]).toMatchObject({
      uri: 'https://cdn.test/clip.mp4',
      posterUri: 'file:///poster.jpg',
      label: 'Beach dog',
      active: true,
    });
  });

  it('opens a voice note full screen with its own shape seed', () => {
    renderViewer({ photos: MIXED, initialIndex: 2 });
    expect(screen.getByTestId('voice-page')).toBeTruthy();
    expect(screen.getByText('Voice note 3 of 3')).toBeTruthy();
    expect(capturedMediaPages.voice[0]).toMatchObject({
      uri: 'file:///note.m4a',
      seed: 'm-1:audio',
      active: true,
    });
  });

  it('keeps a clip silent until its page is the one on screen', () => {
    renderViewer({ photos: MIXED, initialIndex: 0 });
    // The pager mounts its neighbours: only the visible page may play.
    const inactive = capturedMediaPages.video.filter((props) => !props.active);
    const active = capturedMediaPages.video.filter((props) => props.active);
    expect(inactive.length).toBeGreaterThan(0);
    expect(active).toHaveLength(0);
  });

  it('keeps Open memory for photos and drops it from the media pages', () => {
    // A clip and a voice note are opened to be watched or heard; the wall's
    // tile is the way back to the memory.
    const { unmount } = renderViewer({ photos: PHOTOS, initialIndex: 0 });
    expect(screen.getByLabelText('Open memory')).toBeTruthy();
    unmount();
    renderViewer({ photos: MIXED, initialIndex: 1 });
    expect(screen.queryByLabelText('Open memory')).toBeNull();
  });

  it('closes a clip or a voice note through the shrink, not flat', () => {
    // The Feed's close path morphs a photo home. A page with no thumbnail of
    // its own shrinks away instead, and the animation owns the close.
    const onClose = vi.fn();
    mediaCloseSpy.mockClear();
    renderViewer({ photos: MIXED, initialIndex: 1, onClose });
    fireEvent.click(screen.getByLabelText('Close photo'));
    expect(mediaCloseSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PhotoViewer swipeable set', () => {
  it('renders every photo with a counter for a set', () => {
    renderViewer();
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
    expect(screen.getByText('Photo 1 of 3')).toBeTruthy();
    const list = screen.getByTestId('viewer-list');
    expect(list.querySelectorAll('img')).toHaveLength(3);
  });

  it('starts on the tapped page', () => {
    renderViewer({ initialIndex: 2 });
    expect(capturedList.initialScrollIndex).toBe(2);
    expect(capturedList.horizontal).toBe(true);
    expect(capturedList.pagingEnabled).toBe(true);
  });

  it('agrees with the photo on screen: opening at index 3 reads Photo 4 of 5', () => {
    renderViewer({ photos: FIVE, initialIndex: 3 });
    expect(capturedList.initialScrollIndex).toBe(3);
    expect(screen.getByText('Photo 4 of 5')).toBeTruthy();
  });

  it('re-syncs when a later session opens on another photo', () => {
    const { rerender } = renderViewer({ photos: FIVE, initialIndex: 3 });
    expect(screen.getByText('Photo 4 of 5')).toBeTruthy();
    rerender(
      <PhotoViewer
        visible={false}
        photos={FIVE}
        initialIndex={3}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    rerender(
      <PhotoViewer
        visible
        photos={FIVE}
        initialIndex={1}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    expect(capturedList.initialScrollIndex).toBe(1);
    expect(screen.getByText('Photo 2 of 5')).toBeTruthy();
  });

  it('never inherits the previous position when a different set opens', () => {
    const { rerender } = renderViewer({ photos: FIVE, initialIndex: 4 });
    expect(screen.getByText('Photo 5 of 5')).toBeTruthy();
    rerender(
      <PhotoViewer
        visible={false}
        photos={FIVE}
        initialIndex={4}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    rerender(
      <PhotoViewer
        visible
        photos={OTHER_SET}
        initialIndex={0}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    expect(capturedList.initialScrollIndex).toBe(0);
    expect(screen.getByText('Photo 1 of 2')).toBeTruthy();
  });

  it('clamps an out-of-range opening index to the set', () => {
    renderViewer({ photos: FIVE, initialIndex: 99 });
    expect(capturedList.initialScrollIndex).toBe(4);
    expect(screen.getByText('Photo 5 of 5')).toBeTruthy();
  });

  it('clamps a negative opening index to the first photo', () => {
    renderViewer({ photos: FIVE, initialIndex: -3 });
    expect(capturedList.initialScrollIndex).toBe(0);
    expect(screen.getByText('Photo 1 of 5')).toBeTruthy();
  });

  it('does not snap back when the same session re-renders after a swipe', () => {
    const { rerender } = renderViewer({ photos: FIVE, initialIndex: 0 });
    act(() => {
      capturedList.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 * 3 } } });
    });
    expect(screen.getByText('Photo 4 of 5')).toBeTruthy();
    const list = screen.getByTestId('viewer-list');
    // The reset is a session transition, never page !== safeInitialIndex:
    // swiping is not a new session, so the list neither remounts nor moves.
    rerender(
      <PhotoViewer
        visible
        photos={FIVE}
        initialIndex={0}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    expect(screen.getByText('Photo 4 of 5')).toBeTruthy();
    expect(screen.getByTestId('viewer-list')).toBe(list);
  });

  it('mounts a fresh list when the set changes under an open viewer', () => {
    const { rerender } = renderViewer({ photos: FIVE, initialIndex: 0 });
    expect(screen.getByText('Photo 1 of 5')).toBeTruthy();
    const before = screen.getByTestId('viewer-list');
    // initialScrollIndex only applies on mount, so a set that changes while
    // the viewer is open has to mount a new list at the canonical index
    // rather than keep a scroll position the counter no longer matches.
    rerender(
      <PhotoViewer
        visible
        photos={OTHER_SET}
        initialIndex={1}
        onClose={() => {}}
        onOpenMemory={() => {}}
      />
    );
    expect(screen.getByTestId('viewer-list')).not.toBe(before);
    expect(capturedList.initialScrollIndex).toBe(1);
    expect(screen.getByText('Photo 2 of 2')).toBeTruthy();
  });

  it('treats a same-length replacement set as a new session', () => {
    // Length is not identity: these two sets differ only by their photos.
    const setA: ViewerPhoto[] = [
      { uri: 'file:///a-1.jpg', label: 'Set A', momentId: 'm-a' },
      { uri: 'file:///a-2.jpg', label: 'Set A', momentId: 'm-a' },
      { uri: 'file:///a-3.jpg', label: 'Set A', momentId: 'm-a' },
    ];
    const setB: ViewerPhoto[] = [
      { uri: 'file:///b-1.jpg', label: 'Set B', momentId: 'm-b' },
      { uri: 'file:///b-2.jpg', label: 'Set B', momentId: 'm-b' },
      { uri: 'file:///b-3.jpg', label: 'Set B', momentId: 'm-b' },
    ];
    const onOpenMemory = vi.fn();
    const { rerender } = renderViewer({ photos: setA, initialIndex: 1, onOpenMemory });
    expect(screen.getByText('Photo 2 of 3')).toBeTruthy();
    // Swipe away first, so a stale page would be visible as a wrong counter.
    act(() => {
      capturedList.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 * 2 } } });
    });
    expect(screen.getByText('Photo 3 of 3')).toBeTruthy();
    const before = screen.getByTestId('viewer-list');

    rerender(
      <PhotoViewer
        visible
        photos={setB}
        initialIndex={1}
        onClose={() => {}}
        onOpenMemory={onOpenMemory}
      />
    );

    expect(screen.getByTestId('viewer-list')).not.toBe(before);
    expect(capturedList.initialScrollIndex).toBe(1);
    expect(screen.getByText('Photo 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Open memory'));
    expect(onOpenMemory).toHaveBeenCalledWith(setB[1]);
  });

  it('swiping updates the counter and Open memory follows the visible photo', () => {
    const onOpenMemory = vi.fn();
    renderViewer({ onOpenMemory });
    act(() => {
      capturedList.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 * 2 } } });
    });
    expect(screen.getByText('Photo 3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Open memory'));
    expect(onOpenMemory).toHaveBeenCalledWith(PHOTOS[2]);
  });

  it('locks paging while a photo reports itself enlarged', () => {
    renderViewer({ photos: FIVE, initialIndex: 0 });
    expect(capturedList.scrollEnabled).toBe(true);

    // A pinch begins: the pager must stop owning the horizontal axis so the
    // photo's own pan can use it.
    act(() => {
      capturedZoomProps[capturedZoomProps.length - 1].onPagerLockChange(true);
    });
    expect(capturedList.scrollEnabled).toBe(false);

    // Back at rest: paging returns.
    act(() => {
      capturedZoomProps[capturedZoomProps.length - 1].onPagerLockChange(false);
    });
    expect(capturedList.scrollEnabled).toBe(true);
  });

  it('closes from the Close control, after the photo morphs home', () => {
    const onClose = vi.fn();
    renderViewer({ onClose });
    fireEvent.click(screen.getByLabelText('Close photo'));
    // The control asks for the morph; the close follows the morph, not the tap.
    const morphing = capturedZoomProps.filter((props) => props.morphOut);
    expect(morphing).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      morphing[0].onDismiss();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('morphs the visible photo home before closing', () => {
    const onClose = vi.fn();
    renderViewer({ photos: FIVE, initialIndex: 2, onClose });

    // Only the visible page morphs: the pages either side stay put while the
    // viewer closes over them.
    fireEvent.click(screen.getByLabelText('Close photo'));
    expect(capturedZoomProps.filter((props) => props.morphOut)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('seeds the session home from the thumbnail that opened it', () => {
    const origin = { x: 12, y: 240, width: 96, height: 96, radius: 4 };
    renderViewer({ photos: FIVE, initialIndex: 1, origin });
    // Every page shares the session's home (the morph geometry) and its
    // progress, so the open and the drag are one animation...
    const home = capturedZoomProps[0].home;
    expect(home.x.value).toBe(12);
    expect(home.y.value).toBe(240);
    expect(home.width.value).toBe(96);
    expect(home.height.value).toBe(96);
    expect(home.radius.value).toBe(4);
    expect(home.valid.value).toBe(true);
    // ...but only the visible page scrubs it.
    expect(capturedZoomProps[1].active).toBe(true);
    expect(capturedZoomProps[0].active).toBe(false);
    expect(capturedZoomProps[2].active).toBe(false);
  });

  it('has no home to morph into when nothing was measured', () => {
    renderViewer({ photos: FIVE, initialIndex: 0 });
    expect(capturedZoomProps[0].home.valid.value).toBe(false);
    expect(capturedZoomProps[0].morph.t.value).toBe(1);
  });

  it('renders a lone photo with no counter', () => {
    renderViewer({ photos: [PHOTOS[0]] });
    expect(screen.queryByText(/Photo \d+ of/)).toBeNull();
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('renders nothing when hidden or empty', () => {
    const { unmount } = renderViewer({ visible: false });
    expect(screen.queryByLabelText('Close photo')).toBeNull();
    unmount();
    renderViewer({ photos: [] });
    expect(screen.queryByLabelText('Close photo')).toBeNull();
  });
});
