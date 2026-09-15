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
