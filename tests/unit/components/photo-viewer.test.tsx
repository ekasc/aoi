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

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
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

  it('closes from the Close control', () => {
    const onClose = vi.fn();
    renderViewer({ onClose });
    fireEvent.click(screen.getByLabelText('Close photo'));
    expect(onClose).toHaveBeenCalledTimes(1);
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
