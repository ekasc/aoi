import { BottomSheetModal, type BottomSheetMethods } from '@expo/ui/community/bottom-sheet';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type NativeSheetProps = {
  visible: boolean;
  onClose: () => void;
  backgroundStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  dismissible?: boolean;
};

/**
 * The platform's own bottom sheet: SwiftUI presentation detents (a true mini
 * sheet) on iOS, a Compose sheet on Android, and a vaul drawer on web. The OS
 * owns the presentation, motion, material, drag, and dismissal — this wrapper
 * only maps our `visible` boolean onto the imperative present/close API and
 * pipes native dismissal back through `onClose`.
 *
 * Dynamic sizing lets the sheet size to its content (mini by default) and
 * `enablePanDownToClose` turns on swipe-down / backdrop-tap dismissal.
 */
export function NativeSheet({
  visible,
  onClose,
  backgroundStyle,
  children,
  dismissible = true,
}: NativeSheetProps) {
  const surface = useThemeColor({}, 'surface');
  const ref = useRef<BottomSheetMethods>(null);
  const phase = useRef<'hidden' | 'presented' | 'closing'>('hidden');
  const visibleRef = useRef(visible);
  // Bumped when a dismissal finishes with a reopen already requested, so the
  // visibility effect can present after the closed state has been committed.
  const [reopenTicket, setReopenTicket] = useState(0);
  useLayoutEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const handleNativeClose = useCallback(() => {
    if (phase.current === 'hidden') return;
    if (phase.current === 'closing' && visibleRef.current) {
      // A reopen was requested while the dismissal was in flight. Presenting
      // here would reach the platform before it has committed the closed state,
      // and its present() lands on nothing while it still reports itself open.
      // Go hidden now and let the effect below present on the next commit.
      phase.current = 'hidden';
      setReopenTicket((ticket) => ticket + 1);
      return;
    }
    phase.current = 'hidden';
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible && phase.current === 'hidden') {
      phase.current = 'presented';
      ref.current?.present();
    } else if (!visible && phase.current === 'presented') {
      phase.current = 'closing';
      ref.current?.close();
    }
  }, [visible, reopenTicket]);

  return (
    <BottomSheetModal
      ref={ref}
      backgroundStyle={[{ backgroundColor: surface }, backgroundStyle]}
      enableDynamicSizing
      enablePanDownToClose={dismissible}
      // onClose and onDismiss fire together; wiring both to the same handler
      // would call it twice on every dismissal.
      onClose={handleNativeClose}
    >
      {children}
    </BottomSheetModal>
  );
}
