import type { ReactNode } from 'react';
import { Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export type ViewerPresentationProps = {
  children: ReactNode;
  interactive: boolean;
  onRequestClose: () => void;
};

export function ViewerPresentation({ children, interactive, onRequestClose }: ViewerPresentationProps) {
  return (
    <Modal animationType="none" onRequestClose={onRequestClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <GestureHandlerRootView
        accessibilityViewIsModal={interactive}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        onAccessibilityEscape={onRequestClose}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={styles.root}
      >
        {children}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
