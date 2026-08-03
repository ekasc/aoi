import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut, deleteAccount } = useSession();
  const { leaveSpace, space } = useSpace();
  const background = useThemeColor({}, 'background');
  const danger = useThemeColor({}, 'danger');
  const [signOutError, setSignOutError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [leaveError, setLeaveError] = useState('');

  const handleSignOut = useCallback(async () => {
    setSignOutError('');
    try {
      await signOut();
      router.replace('/(public)');
    } catch {
      setSignOutError('Failed to sign out. Please try again.');
    }
  }, [router, signOut]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This will permanently delete your space, all moments, events, and shared data for both you and your partner. This cannot be undone.\n\nEnter your email to confirm deletion.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setDeleteError('');
            try {
              await deleteAccount();
              router.replace('/(public)');
            } catch {
              setDeleteError('Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  }, [deleteAccount, router]);

  const handleLeaveSpace = useCallback(() => {
    Alert.alert(
      'Leave your shared space?',
      `This will archive "${space?.name ?? 'your space'}". Your partner will be notified, and your timeline and events will no longer be visible to you. You can rejoin later if they share an invite code with you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave space',
          style: 'destructive',
          onPress: async () => {
            setLeaveError('');
            try {
              await leaveSpace();
              router.replace('/(auth)/space-setup');
            } catch {
              setLeaveError('Failed to leave space. Please try again.');
            }
          },
        },
      ]
    );
  }, [leaveSpace, router, space?.name]);

  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: insets.top + Spacing[8],
        paddingBottom: insets.bottom + Spacing[16],
      },
    ],
    [insets.bottom, insets.top]
  );

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
    >
      <ThemedText type="title" selectable style={styles.hero}>
        Settings
      </ThemedText>

      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta" style={styles.cardHeading}>
          Appearance
        </ThemedText>
        <ThemeSelector showDescriptions={false} />
      </Surface>

      <Surface style={styles.card}>
        <ThemedText type="meta" style={styles.cardHeading}>
          Session
        </ThemedText>
        <Button label="Sign out" variant="secondary" onPress={handleSignOut} />
        {signOutError ? (
          <ThemedText
            accessibilityRole="alert"
            type="caption"
            style={{ color: danger }}
          >
            {signOutError}
          </ThemedText>
        ) : null}

        <View style={styles.spaceSection}>
          <Button
            label="Leave space"
            variant="secondary"
            onPress={handleLeaveSpace}
          />
          {leaveError ? (
            <ThemedText
              accessibilityRole="alert"
              type="caption"
              style={{ color: danger }}
            >
              {leaveError}
            </ThemedText>
          ) : null}
          <Button
            label="Delete account"
            variant="destructive"
            onPress={handleDeleteAccount}
          />
          {deleteError ? (
            <ThemedText
              accessibilityRole="alert"
              type="caption"
              style={{ color: danger }}
            >
              {deleteError}
            </ThemedText>
          ) : null}
        </View>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[16],
    paddingBottom: Spacing[24],
  },
  hero: {
    marginBottom: Spacing[4],
  },
  card: {
    gap: Spacing[8],
  },
  cardHeading: {
    marginBottom: Spacing[4],
  },
  spaceSection: {
    gap: Spacing[8],
    marginTop: Spacing[8],
  },
});
