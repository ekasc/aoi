import { BottomSheetModal, type BottomSheetMethods } from '@expo/ui/community/bottom-sheet';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type NativeSheetProps = {
  visible: boolean;
  onClose: () => void;
  backgroundStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
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
}: NativeSheetProps) {
  const ref = useRef<BottomSheetMethods>(null);
  // Tracks whether the sheet is currently presented so a native-initiated
  // dismissal (drag / backdrop) does not also get a programmatic close(),
  // which re-triggered the dismissal animation and flickered.
  const presentedRef = useRef(false);

  const handleNativeClose = useCallback(() => {
    presentedRef.current = false;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      presentedRef.current = true;
      ref.current?.present();
    } else if (presentedRef.current) {
      presentedRef.current = false;
      ref.current?.close();
    }
  }, [visible]);

  return (
    <BottomSheetModal
      ref={ref}
      backgroundStyle={backgroundStyle}
      enableDynamicSizing
      enablePanDownToClose
      // onClose and onDismiss fire together; wiring both to the same handler
      // would call it twice on every dismissal.
      onClose={handleNativeClose}
    >
      {children}
    </BottomSheetModal>
  );
}
