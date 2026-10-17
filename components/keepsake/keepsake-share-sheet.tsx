import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import ViewShot, { captureRef, type ViewShotRef } from 'react-native-view-shot';

import { KeepsakeCard, type KeepsakeCardData } from '@/components/keepsake/keepsake-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Spacing } from '@/constants/theme';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Preview + share for one keepsake card. The preview IS the artifact: the
 * capture runs against the same mounted view the reader approves, so what
 * leaves the phone is exactly what was shown. Sharing is unavailable on
 * web (no view-shot capture there) — the preview still renders.
 */
export function KeepsakeShareSheet({
  visible,
  onClose,
  card,
}: {
  visible: boolean;
  onClose: () => void;
  card: KeepsakeCardData;
}) {
  const { colors, selectedTheme } = useAoiTheme();
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const shotRef = useRef<ViewShotRef>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');

  const handleShare = useCallback(async () => {
    if (isSharing) return;
    setIsSharing(true);
    setShareError('');
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri);
      onClose();
    } catch {
      setShareError("Couldn't make the card just now. Try again?");
    } finally {
      setIsSharing(false);
    }
  }, [isSharing, onClose]);

  return (
    <NativeSheet visible={visible} onClose={onClose}>
      <View
        accessibilityViewIsModal
        accessibilityLabel="Share this keepsake card"
        role="dialog"
        aria-modal
        style={styles.content}
      >
        <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }} style={styles.preview}>
          <KeepsakeCard card={card} colors={colors} themeName={selectedTheme.name} />
        </ViewShot>
        {shareError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {shareError}
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          <Button
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: isSharing }}
            disabled={isSharing}
            label={isSharing ? 'Preparing…' : 'Share'}
            onPress={() => void handleShare()}
          />
          <Button label="Not now" variant="secondary" onPress={onClose} />
        </View>
        {process.env.EXPO_OS === 'web' ? (
          <ThemedText type="caption" style={{ color: muted }}>
            Sharing leaves from the app — this preview shows what the card looks like.
          </ThemedText>
        ) : null}
      </View>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[24],
    paddingBottom: Spacing[32],
  },
  preview: {
    width: '100%',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[12],
  },
});
