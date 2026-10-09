import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useSkyEntry, type SkyEntry } from '@/components/home/sky-entry-provider';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useAoiTheme } from '@/features/theme/theme-context';
import { isDarkBackground } from '@/components/home/memory-sky';
import { inviteAppLink, inviteMessage } from '@/features/space/invite-code';

export function SkyWelcome({ details, onEnter }: { details: SkyEntry; onEnter: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useAoiTheme();
  const ink = { color: colors.textPrimary };
  const muted = { color: colors.textMuted };
  const { copied, copy } = useCopyToClipboard();
  const { arrival } = useSkyEntry();
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);
  const code = details.inviteCode;
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: arrival?.value ?? 1,
    transform: [{ translateY: (1 - (arrival?.value ?? 1)) * 18 }],
  }));

  /**
   * The link, not just the code.
   *
   * A code typed out is six characters of friction and one easy typo. The link
   * opens aoi with the code already filled in, which is the whole reason to
   * send one. The message still says the code in words, so a link that cannot
   * open leaves them able to join anyway.
   */
  const handleShare = useCallback(async () => {
    if (!code || sharing) return;
    setShareError('');
    setSharing(true);
    try {
      await Share.share({
        message: inviteMessage(code, details.name, details.partnerName),
        url: inviteAppLink(code),
      });
    } catch {
      setShareError("Couldn't open sharing. Copy the code instead.");
    } finally {
      setSharing(false);
    }
  }, [code, details.name, details.partnerName, sharing]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing[24], paddingBottom: insets.bottom + Spacing[24] }]}>
      <StatusBar style={isDarkBackground(colors.background) ? 'light' : 'dark'} />
      <ThemedText type="meta" style={muted}>aoi</ThemedText>
      <Animated.View style={[styles.invitation, entranceStyle]} testID="sky-invitation-content">
        {details.photoUri ? <Image accessible={false} source={{ uri: details.photoUri }} contentFit="cover" style={styles.photo} /> : null}
        <ThemedText type="title" style={ink}>{details.name || 'Your sky'}</ThemedText>
        {details.kind === 'created' ? (
          <View accessible accessibilityLabel={`Your invite code, ${details.inviteCode.split('').join(' ')}`} style={styles.codeBlock}>
            <ThemedText type="meta" style={muted}>Your invite code</ThemedText>
            <View style={styles.codeRow}>
              {details.inviteCode.split('').map((character, index) => (
                <ThemedText key={`${character}-${index}`} style={[styles.code, ink]}>{character}</ThemedText>
              ))}
            </View>
          </View>
        ) : <ThemedText style={muted}>{details.partnerName ? `${details.partnerName} is already here.` : 'Your space is ready.'}</ThemedText>}
        {details.kind === 'created' ? (
          <>
            {/* The link is the good path and the share sheet is the natural way
                to send one, so sharing leads and copying is the fallback for
                when there is no one to message yet. */}
            <Button
              disabled={!code || sharing}
              label={sharing ? 'Opening…' : 'Share invite'}
              variant="muted"
              onPress={() => void handleShare()}
            />
            {/* The button says it copied. A line underneath saying the same
                thing was the app repeating itself in two places, and it moved
                everything below it when it appeared. */}
            <Button
              accessibilityLiveRegion="polite"
              label={copied(code) ? 'Code copied' : 'Copy code instead'}
              variant="muted"
              onPress={() => copy(code)}
            />
            {shareError ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: colors.destructive }}>
                {shareError}
              </ThemedText>
            ) : null}
          </>
        ) : null}
        <Button label="Enter your sky" onPress={onEnter} />
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: Spacing[24], maxWidth: 560, width: '100%', alignSelf: 'center' },
  invitation: { flex: 1, justifyContent: 'center', gap: Spacing[16], paddingTop: Spacing[24] },
  photo: { width: 88, height: 88, borderRadius: Radii.md },
  codeBlock: { gap: Spacing[8], marginVertical: Spacing[16] },
  codeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[12] },
  code: { fontSize: 36, lineHeight: 48 },
});
