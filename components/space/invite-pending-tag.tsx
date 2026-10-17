import { useCallback, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';

import { useSkyEntry } from '@/components/home/sky-entry-provider';
import { ThemedText } from '@/components/themed-text';
import { fabBottomOffset } from '@/components/home/compact-sky-geometry';
import { Radii, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { inviteMessage } from '@/features/space/invite-code';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

/**
 * A minimal invite status tag, floating centered above the tab bar on every
 * tab screen while no partner has joined. Tapping it shares the invite link
 * (regenerating first when the code expired), so the code stays one tap
 * away without taking over any screen. Hidden off tab routes, during the
 * sky entry takeover, and once the partner joins.
 */
export function InvitePendingTag() {
  const segments = useSegments();
  const { entry } = useSkyEntry();
  const { user } = useSession();
  const { space, regenerateInvite } = useSpace();
  const insets = useSafeAreaInsets();
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const danger = useThemeColor({}, 'danger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const waitingForPartner = Boolean(space) && !space?.partnerJoined;
  const inviteCode = space?.inviteCode;
  const onTabRoute = (segments as readonly string[])[1] === '(tabs)';

  const handlePress = useCallback(async () => {
    if (busy) {
      return;
    }
    setError('');
    setBusy(true);
    try {
      let code = inviteCode;
      if (!code) {
        try {
          code = await regenerateInvite();
        } catch {
          setError("Couldn't create a new code. Please try again.");
          return;
        }
        if (!code) {
          setError("Couldn't create a new code. Please try again.");
          return;
        }
      }
      await Share.share({
        message: inviteMessage(
          code,
          user?.displayName?.trim() || 'Your partner',
          space?.partnerName ?? null,
        ),
      });
    } catch {
      setError("Couldn't open sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, inviteCode, regenerateInvite, space, user]);

  if (!waitingForPartner || !onTabRoute || entry !== null) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.tag, { bottom: fabBottomOffset(insets.bottom, process.env.EXPO_OS === 'ios') }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint={inviteCode ? 'Shares your invite link' : 'Creates a fresh invite code and shares it'}
        hitSlop={12}
        disabled={busy}
        onPress={() => void handlePress()}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: surface, borderColor: border },
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}
      >
        <View accessible={false} style={[styles.dot, { backgroundColor: accent }]} />
        <ThemedText type="caption" style={{ color: text }}>
          {inviteCode ? 'Invite pending' : 'Invite expired'}
        </ThemedText>
      </Pressable>
      {error ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing[8],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[8],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.55,
  },
});
