import { useCallback, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Modal, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  cancelSelection,
  completeSelection,
  getPendingSelection,
  subscribeSelection,
} from '@/features/dev/debug-capture';
import { useThemeColor } from '@/hooks/use-theme-color';

type DebugHarnessProps = { children: ReactNode };

/**
 * Dev-only wrapper that gives the agent a handle on whatever the app is
 * showing on a physical device. It keeps a ref to the app subtree (so the
 * element inspector can hit-test it) and mounts the tap-to-select overlay.
 * Returns children untouched
 * when `__DEV__` is false, so production bundles and routing are unaffected.
 */
export function DebugHarness({ children }: DebugHarnessProps) {
  const appRef = useRef<View>(null);

  if (!__DEV__) {
    return <>{children}</>;
  }

  return (
    <View style={styles.root}>
      <View collapsable={false} ref={appRef} style={styles.app}>
        {children}
      </View>
      <ElementPicker appRef={appRef} />
    </View>
  );
}

function ElementPicker({ appRef }: { appRef: RefObject<View | null> }) {
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const pending = useSyncExternalStore(
    subscribeSelection,
    getPendingSelection,
    getPendingSelection
  );
  const selecting = pending !== null;

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const { pageX, pageY } = event.nativeEvent;
      void completeSelection(appRef.current, pageX, pageY);
    },
    [appRef]
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={cancelSelection}
      transparent
      visible={selecting}
    >
      <Pressable
        accessibilityLabel="Tap an element to send it to the agent"
        accessibilityRole="button"
        accessibilityViewIsModal
        onPress={handlePress}
        style={styles.backdrop}
      >
        <View style={[styles.banner, { backgroundColor: surface, borderColor: border }]}>
          <ThemedText type="caption">Tap an element to send it to your agent</ThemedText>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  app: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    alignItems: 'center',
  },
  banner: {
    marginTop: Spacing[56],
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[8],
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
