import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { NativeDateTimeField } from "@/components/forms/native-date-time-field";
import { Spacing } from "@/constants/theme";
import { isStubMode } from "@/features/api-client";
import { useMediaUpload } from "@/features/media/use-media-upload";
import type { SessionUser } from "@/features/session/types";
import { useSession } from "@/features/session/session-context";
import { isInviteCodeFormat, normalizeInviteCode } from "@/features/space/invite-code";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

type SpaceMode = 'create' | 'join';

function getErrorMessage(value: unknown, fallback: string) {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  return fallback;
}

function deriveName(user: SessionUser | null): string {
  if (!user) return '';

  const displayName = user.displayName?.trim();
  if (displayName) return displayName;

  const email = user.email?.trim();
  if (email) {
    const localPart = email.split('@')[0];
    return localPart
      .split(/[._-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  return '';
}

export default function SpaceSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { user, signOut } = useSession();
  const { createSpace, joinSpace } = useSpace();
  const { uploadImage, state: uploadState } = useMediaUpload();

  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const background = useThemeColor({}, 'background');

  const [mode, setMode] = useState<SpaceMode>('create');
  const [yourName, setYourName] = useState(deriveName(user));
  const [partnerName, setPartnerName] = useState('');
  const [spaceName, setSpaceName] = useState('Our space');
  const [inviteCode, setInviteCode] = useState('');
  const [relationshipStartDate, setRelationshipStartDate] = useState(() => new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);

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

  const handlePickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      setPhotoUri(result.assets[0].uri);
      clearError();
    }
  }, [clearError]);

  const handleRemovePhoto = useCallback(() => {
    setPhotoUri(null);
  }, []);

  const handleCreateSpace = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }

    const trimmedSpaceName = spaceName.trim();
    const trimmedYourName = yourName.trim();
    const trimmedPartnerName = partnerName.trim();

    if (!trimmedSpaceName) {
      setError('Space name is required.');
      return;
    }

    if (!trimmedYourName) {
      setError('Your name is required.');
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

      let resolvedPhotoUri = photoUri;

      if (photoUri && !isStubMode()) {
        const uploadedUrl = await uploadImage({ uri: photoUri, mimeType: 'image/jpeg' });
        if (!uploadedUrl) {
          setError('Failed to upload photo. Please try again.');
          setIsSubmitting(false);
          return;
        }
        resolvedPhotoUri = uploadedUrl;
      }

      await createSpace({
        name: trimmedSpaceName,
        createdByUserId: user.id,
        yourName: trimmedYourName,
        partnerName: trimmedPartnerName,
        relationshipStartDate: relationshipStartDate.toISOString(),
        photoUri: resolvedPhotoUri ?? undefined,
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
    photoUri,
    relationshipStartDate,
    router,
    spaceName,
    uploadImage,
    user,
    yourName,
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

  const previewLabel = `${yourName.trim() || 'You'} and ${partnerName.trim() || '...'}`;
  const isUploading = uploadState === 'uploading' || uploadState === 'confirming';

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
          <View style={styles.previewSection}>
            <Pressable
              accessibilityLabel={photoUri ? 'Change couple photo' : 'Add couple photo'}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handlePickPhoto}
              style={[styles.photoCircle, { borderColor: border, backgroundColor: surface2 }]}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} contentFit="cover" />
              ) : (
                <Ionicons color={muted} name="camera-outline" size={28} />
              )}
            </Pressable>
            {photoUri ? (
              <Pressable
                accessibilityLabel="Remove photo"
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={handleRemovePhoto}
                style={styles.photoRemove}
              >
                <ThemedText type="caption" style={{ color: muted }}>Remove</ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="caption" style={{ color: muted, marginTop: Spacing[4] }}>
                Add a photo
              </ThemedText>
            )}

            <ThemedText
              type="display"
              selectable={false}
              style={styles.previewName}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {previewLabel}
            </ThemedText>
            <ThemedText type="meta" style={{ color: muted }}>
              Your shared space
            </ThemedText>
          </View>

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
                  <Ionicons
                    color={mode === 'create' ? onAccent : muted}
                    name="add-circle-outline"
                    size={20}
                    style={styles.modeIcon}
                  />
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
                  <Ionicons
                    color={mode === 'join' ? onAccent : muted}
                    name="enter-outline"
                    size={20}
                    style={styles.modeIcon}
                  />
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
                <ThemedText type="meta">Your name</ThemedText>
                <TextInput
                  accessibilityLabel="Your name"
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setYourName(value);
                    clearError();
                  }}
                  placeholder="Your name"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={yourName}
                />
                <ThemedText type="caption" style={{ color: muted }}>
                  How we&apos;ll refer to you in your space.
                </ThemedText>

                <View style={styles.fieldSpacer} />

                <ThemedText type="meta">Partner&apos;s name</ThemedText>
                <TextInput
                  accessibilityLabel="Partner name"
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setPartnerName(value);
                    clearError();
                  }}
                  placeholder="Their name"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={partnerName}
                />
                <ThemedText type="caption" style={{ color: muted }}>
                  We&apos;ll label their moments with this name.
                </ThemedText>

                <View style={styles.fieldSpacer} />

                <ThemedText type="meta">Space name</ThemedText>
                <TextInput
                  accessibilityLabel="Space name"
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setSpaceName(value);
                    clearError();
                  }}
                  placeholder="e.g. Our world"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={spaceName}
                />
                <ThemedText type="caption" style={{ color: muted }}>
                  What you&apos;ll call your shared space.
                </ThemedText>

                <View style={styles.fieldSpacer} />

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
                <ThemedText type="caption" style={{ color: muted }}>
                  Your timeline will begin from this day.
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="meta">Invite code</ThemedText>
                <TextInput
                  accessibilityLabel="Invite code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setInviteCode(normalizeInviteCode(value));
                    clearError();
                  }}
                  placeholder="Enter 6-character code"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={inviteCode}
                />
                <ThemedText type="caption" style={{ color: muted }} selectable>
                  Ask your partner to share their invite code from their space settings.
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
            disabled={isSubmitting || isUploading}
            label={
              isSubmitting || isUploading
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
    gap: Spacing[16],
  },
  previewSection: {
    alignItems: 'center',
    gap: Spacing[4],
    paddingVertical: Spacing[8],
  },
  photoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: {
    width: 88,
    height: 88,
  },
  photoRemove: {
    marginTop: Spacing[4],
  },
  previewName: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    marginTop: Spacing[8],
    textAlign: 'center',
  },
  modeCard: {
    gap: Spacing[8],
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  modeButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  modeIcon: {
    marginRight: 6,
  },
  formCard: {
    gap: Spacing[4],
  },
  fieldSpacer: {
    height: Spacing[8],
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
    gap: Spacing[12],
  },
});
