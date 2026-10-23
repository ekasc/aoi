import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { FullWindowOverlay } from 'react-native-screens';

import type { ViewerPresentationProps } from './viewer-presentation';

export function ViewerPresentation({ children, interactive, onRequestClose }: ViewerPresentationProps) {
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={interactive}>
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
    </FullWindowOverlay>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
