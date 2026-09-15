import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Modal, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  cancelSelection,
  completeSelection,
  getPendingSelection,
  subscribeSelection,
} from '@/features/dev/debug-capture';
import { captureScreenOutline } from '@/features/dev/element-tree';
import { useThemeColor } from '@/hooks/use-theme-color';

type DebugHarnessProps = { children: ReactNode };

/**
 * Dev-only wrapper that gives the agent a handle on whatever the app is
 * showing on a physical device. It keeps a ref to the app subtree (so the
 * element inspector can hit-test it), mounts the tap-to-select overlay, and
 * floats a "copy this screen's elements" button. Returns children untouched
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
      <ScreenOutlineButton />
      <ElementPicker appRef={appRef} />
    </View>
  );
}

/**
 * Copies a text outline of the current screen's element tree to the
 * clipboard, so the user can paste it into their agent chat.
 */
function ScreenOutlineButton() {
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const handlePress = useCallback(async () => {
    const outline = captureScreenOutline();
    try {
      await Clipboard.setStringAsync(outline);
      setState('copied');
    } catch {
      setState('error');
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setState('idle'), 1800);
  }, []);

  const label = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : null;

  return (
    <View style={styles.copyAnchor} pointerEvents="box-none">
      <Pressable
        accessibilityLabel="Copy this screen's elements"
        accessibilityRole="button"
        onPress={handlePress}
        style={[styles.copyButton, { backgroundColor: surface, borderColor: border }]}
      >
        <Ionicons
          color={state === 'error' ? '#B3261E' : text}
          name={state === 'copied' ? 'checkmark' : 'copy-outline'}
          size={18}
        />
      </Pressable>
      {label ? (
        <View style={[styles.copyToast, { backgroundColor: surface, borderColor: border }]}>
          <ThemedText type="caption">{label}</ThemedText>
        </View>
      ) : null}
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
  copyAnchor: {
    position: 'absolute',
    left: Spacing[16],
    bottom: Spacing[40],
    alignItems: 'center',
  },
  copyButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
  },
  copyToast: {
    position: 'absolute',
    bottom: 52,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[4],
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
