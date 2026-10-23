import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import type { ModalProps, ViewProps } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewerPresentation } from '@/components/moments/viewer-presentation.ios';
import { ViewerPresentation as ModalPresentation } from '@/components/moments/viewer-presentation';

const roots: ViewProps[] = [];
const overlays: { unstable_accessibilityContainerViewIsModal: boolean }[] = [];
const modals: ModalProps[] = [];

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Modal: (props: ModalProps) => {
    modals.push(props);
    return props.children;
  },
}));
vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: (props: ViewProps) => {
    roots.push(props);
    return props.children;
  },
}));
vi.mock('react-native-screens', () => ({
  FullWindowOverlay: (props: { children: ReactNode; unstable_accessibilityContainerViewIsModal: boolean }) => {
    overlays.push(props);
    return props.children;
  },
}));

beforeEach(() => {
  roots.length = 0;
  overlays.length = 0;
  modals.length = 0;
});

describe('iOS viewer presentation', () => {
  it('releases native hit-testing and the accessibility trap while keeping the returning image mounted', () => {
    const removed = vi.fn();
    function ReturningImage() {
      useEffect(() => () => { removed(); }, []);
      return null;
    }
    const onRequestClose = vi.fn();
    const { rerender, unmount } = render(
      <ViewerPresentation interactive onRequestClose={onRequestClose}><ReturningImage /></ViewerPresentation>,
    );
    expect(roots.at(-1)?.pointerEvents).toBe('auto');
    expect(overlays.at(-1)?.unstable_accessibilityContainerViewIsModal).toBe(true);

    rerender(<ViewerPresentation interactive={false} onRequestClose={onRequestClose}><ReturningImage /></ViewerPresentation>);
    expect(roots.at(-1)?.pointerEvents).toBe('none');
    expect(roots.at(-1)?.accessibilityElementsHidden).toBe(true);
    expect(roots.at(-1)?.accessibilityViewIsModal).toBe(false);
    expect(overlays.at(-1)?.unstable_accessibilityContainerViewIsModal).toBe(false);
    expect(modals).toHaveLength(0);
    expect(removed).not.toHaveBeenCalled();
    unmount();
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen-reader escape action wired to dismissal', () => {
    const close = vi.fn();
    render(<ViewerPresentation interactive onRequestClose={close}>{null}</ViewerPresentation>);
    roots.at(-1)?.onAccessibilityEscape?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retains the modal fallback and hardware-back dismissal outside iOS', () => {
    const close = vi.fn();
    render(<ModalPresentation interactive onRequestClose={close}>{null}</ModalPresentation>);
    expect(modals.at(-1)).toMatchObject({ animationType: 'none', transparent: true, visible: true });
    expect(modals.at(-1)?.onRequestClose).toBe(close);
  });
});
