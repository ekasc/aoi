import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { isInviteCodeFormat, normalizeInviteCode } from '@/features/space/invite-code';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

type SpaceMode = 'create' | 'join';

function getErrorMessage(value: unknown, fallback: string) {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  return fallback;
}

export default function SpaceSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { user, signOut } = useSession();
  const { createSpace, joinSpace } = useSpace();

  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const background = useThemeColor({}, 'background');

  const [mode, setMode] = useState<SpaceMode>('create');
  const [spaceName, setSpaceName] = useState('Our space');
  const [partnerName, setPartnerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [relationshipStartDate, setRelationshipStartDate] = useState(() => new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        borderColor: border,
        backgroundColor: surface2,
        color: text,
      },
    ],
    [border, surface2, text]
  );

  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: insets.top + Spacing[12],
        paddingBottom: insets.bottom + Spacing[24],
      },
    ],
    [insets.bottom, insets.top]
  );

  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12], borderColor: border }],
    [border, insets.bottom]
  );

  const clearError = useCallback(() => {
    if (error) {
      setError('');
    }
  }, [error]);

  const handleCreateSpace = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }

    const trimmedSpaceName = spaceName.trim();
    const trimmedPartnerName = partnerName.trim();

    if (!trimmedSpaceName) {
      setError('Space name is required.');
      return;
    }

    if (!trimmedPartnerName) {
      setError('Partner name is required.');
      return;
    }

    if (Number.isNaN(relationshipStartDate.getTime())) {
      setError('Choose a valid relationship start date.');
      return;
    }

    try {
      setIsSubmitting(true);
      clearError();
      await createSpace({
        name: trimmedSpaceName,
        createdByUserId: user.id,
        partnerName: trimmedPartnerName,
        relationshipStartDate: relationshipStartDate.toISOString(),
      });
      router.replace('/(auth)/space-import');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to create your space right now.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    clearError,
    createSpace,
    partnerName,
    relationshipStartDate,
    router,
    spaceName,
    user,
  ]);

  const handleJoinSpace = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }

    const normalizedInvite = normalizeInviteCode(inviteCode);

    if (!isInviteCodeFormat(normalizedInvite)) {
      setError('Enter a valid 6-character invite code.');
      return;
    }

    try {
      setIsSubmitting(true);
      clearError();
      await joinSpace({ userId: user.id, inviteCode: normalizedInvite });
      router.replace('/(auth)/theme-select');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to join with this invite code.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [clearError, inviteCode, joinSpace, router, user]);

  const handleContinue = useCallback(() => {
    if (mode === 'create') {
      void handleCreateSpace();
      return;
    }

    void handleJoinSpace();
  }, [handleCreateSpace, handleJoinSpace, mode]);

  return (
    <>
      <Stack.Screen options={{ title: 'Relationship setup', headerBackVisible: false }} />
      <KeyboardAvoidingView
        behavior={isIos ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: background }]}
      >
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Surface variant="raised" style={styles.heroCard}>
            <ThemedText type="meta" style={{ color: muted }} selectable>
              Step 1 of 3
            </ThemedText>
            <ThemedText type="title" selectable>
              Set up your shared space
            </ThemedText>
            <ThemedText type="caption" style={{ color: muted }} selectable>
              Create one together or join with an invite code.
            </ThemedText>
          </Surface>

          <Surface style={styles.modeCard}>
            <View accessibilityRole="radiogroup">
              <View style={styles.modeRow}>
                <Pressable
                  accessibilityLabel="Create a new space"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === 'create' }}
                  onPress={() => {
                    setMode('create');
                    clearError();
                  }}
                  style={[
                    styles.modeButton,
                    {
                      backgroundColor: mode === 'create' ? accent : surface2,
                      borderColor: mode === 'create' ? accent : border,
                    },
                  ]}
                >
                  <ThemedText type="body" style={{ color: mode === 'create' ? onAccent : text }}>
                    Create
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityLabel="Join an existing space"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === 'join' }}
                  onPress={() => {
                    setMode('join');
                    clearError();
                  }}
                  style={[
                    styles.modeButton,
                    {
                      backgroundColor: mode === 'join' ? accent : surface2,
                      borderColor: mode === 'join' ? accent : border,
                    },
                  ]}
                >
                  <ThemedText type="body" style={{ color: mode === 'join' ? onAccent : text }}>
                    Join
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </Surface>

          <Surface variant="raised" style={styles.formCard}>
            {mode === 'create' ? (
              <>
                <TextInput
                  accessibilityLabel="Space name"
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setSpaceName(value);
                    clearError();
                  }}
                  placeholder="Space name"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={spaceName}
                />
                <TextInput
                  accessibilityLabel="Partner name"
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setPartnerName(value);
                    clearError();
                  }}
                  placeholder="Partner name"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={partnerName}
                />

                <NativeDateTimeField
                  accessibilityLabel="Choose relationship start date"
                  label="Relationship start date"
                  mode="date"
                  onChange={(nextDate) => {
                    setRelationshipStartDate(nextDate);
                    clearError();
                  }}
                  value={relationshipStartDate}
                />
              </>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Invite code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setInviteCode(normalizeInviteCode(value));
                    clearError();
                  }}
                  placeholder="Invite code"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={inviteCode}
                />
                <ThemedText type="caption" style={{ color: muted }} selectable>
                  Ask your partner for their 6-character code.
                </ThemedText>
              </>
            )}

            {error ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                {error}
              </ThemedText>
            ) : null}
          </Surface>
        </ScrollView>

        <View style={[footerStyle, { backgroundColor: background }]}>
          <Button
            disabled={isSubmitting}
            label={
              isSubmitting
                ? mode === 'create'
                  ? 'Creating...'
                  : 'Joining...'
                : mode === 'create'
                  ? 'Continue'
                  : 'Join space'
            }
            onPress={handleContinue}
          />
          <Button
            label="Use another account"
            onPress={() => void signOut()}
            variant="secondary"
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing[16],
    gap: Spacing[12],
  },
  heroCard: {
    gap: Spacing[8],
  },
  modeCard: {
    gap: Spacing[8],
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  modeButton: {
    minHeight: 44,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  formCard: {
    gap: Spacing[12],
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
