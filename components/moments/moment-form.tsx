import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { MediaPicker } from '@/components/media/media-picker';
import { UploadProgress } from '@/components/media/upload-progress';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { newDraftClientId } from '@/features/moments/draft-identity';
import { isQuotaExceededError, useMediaUpload } from '@/features/media/use-media-upload';
import { useSubscription } from '@/features/subscription/subscription-context';
import type { Moment, MomentType } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

type MomentTypeOption = {
  value: MomentType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
};

const MOMENT_TYPES: MomentTypeOption[] = [
  { value: 'note', label: 'Note', icon: 'create-outline', description: 'A quick thought' },
  { value: 'milestone', label: 'Milestone', icon: 'trophy-outline', description: 'Something important' },
  { value: 'date', label: 'Date', icon: 'calendar-outline', description: 'When we were together' },
  { value: 'media', label: 'Media', icon: 'camera-outline', description: 'A photo or video' },
  // No 'goal' option: future goals are Plans-owned (created/read there).
  // Editing an existing goal keeps its type via initial state below.
];

const TYPE_ICON_SIZE = 22;

export type MomentFormValues = {
  type: MomentType;
  title: string;
  body: string;
  occurredAt: string;
  targetAt: string | null;
  mediaPreview: string | null;
  audioUri: string | null;
  /** Stable media object id (create + edit); null when no media. */
  mediaId: string | null;
  /**
   * Opaque per-draft idempotency key (create mode only). One id per draft
   * instance, stable across retries and edits, so a double-tap on Save
   * replays server-side instead of creating two moments.
   */
  clientId?: string;
};

export type MomentFormProps = {
  heroTitle: string;
  heroSubtitle: string;
  submitLabel: string;
  submittingLabel: string;
  /** Present in edit mode — prefills the form and locks trace typing. */
  initialMoment?: Moment;
  /** Create-mode starting type (e.g. Plans goal capture locks 'goal'). */
  defaultType?: MomentType;
  /** Hide the type picker entirely (the type is fixed by the caller). */
  hideTypePicker?: boolean;
  onSubmit: (values: MomentFormValues) => Promise<void>;
  onCancel: () => void;
};

/**
 * The shared capture/edit form. Edit mode (behind `moment/edit/[id]`)
 * prefills from `initialMoment` and preserves occurredAt/audioUri untouched.
 */
export function MomentForm({
  heroTitle,
  heroSubtitle,
  submitLabel,
  submittingLabel,
  initialMoment,
  defaultType,
  hideTypePicker,
  onSubmit,
  onCancel,
}: MomentFormProps) {
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { uploadImage, state: uploadState, progress: uploadProgress, error: uploadError, reset: resetUpload } = useMediaUpload();
  const { refreshServerPlus } = useSubscription();
  const router = useRouter();
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const initialMediaPreview = initialMoment?.mediaPreview ?? null;

  const [type, setType] = useState<MomentType>(initialMoment?.type ?? defaultType ?? 'note');
  const [title, setTitle] = useState(initialMoment?.title ?? '');
  const [body, setBody] = useState(initialMoment?.body ?? '');
  const [hasTargetDate, setHasTargetDate] = useState(Boolean(initialMoment?.targetAt));
  const [targetAt, setTargetAt] = useState(() => {
    if (initialMoment?.targetAt) {
      const parsed = new Date(initialMoment.targetAt);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    const value = new Date();
    value.setMonth(value.getMonth() + 3);
    return value;
  });
  const [error, setError] = useState('');
  // Shown only after the server itself enforces media quota, the draft
  // (title/body/media/date) is never cleared, so nothing is lost.
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mediaUri, setMediaUri] = useState<string | null>(initialMediaPreview);
  const [selectedMimeType, setSelectedMimeType] = useState('image/jpeg');
  // Same-tick double-tap guard: useState flips don't apply within the tick,
  // so a rapid second Save would otherwise issue a duplicate request.
  const savingRef = useRef(false);

  // Traces are zero-decision captures — editing keeps their type locked.
  // Callers (e.g. Plans goal capture) can lock any fixed type the same way.
  const showTypePicker =
    !hideTypePicker && (!initialMoment || initialMoment.type !== 'trace');

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const isMedia = type === 'media';
  const isGoal = type === 'goal';
  const hasMedia = isMedia && !!mediaUri;
  const hasText = trimmedTitle.length > 0 || trimmedBody.length > 0;
  const canSubmit = hasText || hasMedia;

  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom],
  );

  // Create-mode idempotency key: one opaque id per draft instance, held
  // stable for the draft's lifetime. Retries reuse it (server replays);
  // editing contents never changes it; abandoning the draft and starting
  // another generates a new one, even for identical content. Edit mode
  // addresses an existing moment by id, no key needed.
  const [draftClientId] = useState<string | undefined>(() =>
    initialMoment ? undefined : newDraftClientId(),
  );

  const occurredCaption = useMemo(() => {
    if (initialMoment) {
      return `Captured · ${new Date(initialMoment.occurredAt).toLocaleDateString('en-US')}`;
    }
    return `Today · ${new Date().toLocaleDateString('en-US')}`;
  }, [initialMoment]);

  const handleSave = useCallback(async () => {
    if (!canSubmit) {
      setError('Add a title, note, or media before saving.');
      return;
    }
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;

    setIsSaving(true);
    setError('');

    try {
      let mediaPreview: string | null = null;
      let mediaId: string | null = null;

      if (mediaUri) {
        if (initialMediaPreview && mediaUri === initialMediaPreview) {
          // Unchanged remote media — no re-upload needed.
          mediaPreview = initialMediaPreview;
          mediaId = initialMoment?.mediaId ?? null;
        } else {
          try {
            const uploaded = await uploadImage({ uri: mediaUri, mimeType: selectedMimeType });
            // Stable URL + stable media id; the presigned URL never leaves
            // the upload flow.
            mediaPreview = uploaded.url;
            mediaId = uploaded.mediaId;
          } catch (err) {
            if (isQuotaExceededError(err)) {
              // Draft fully preserved; explain the actual limit and offer Plus.
              void refreshServerPlus();
              setQuotaBlocked(true);
            } else {
              setError('Failed to upload media. Please try again.');
            }
            setIsSaving(false);
            savingRef.current = false;
            return;
          }
        }
      }

      await onSubmit({
        type,
        title: trimmedTitle,
        body: trimmedBody,
        occurredAt: initialMoment?.occurredAt ?? new Date().toISOString(),
        targetAt: isGoal && hasTargetDate ? targetAt.toISOString() : null,
        mediaPreview,
        mediaId,
        audioUri: initialMoment?.audioUri ?? null,
        clientId: draftClientId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save moment');
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [
    canSubmit,
    draftClientId,
    hasTargetDate,
    initialMediaPreview,
    initialMoment,
    isGoal,
    mediaUri,
    onSubmit,
    selectedMimeType,
    targetAt,
    trimmedBody,
    trimmedTitle,
    type,
    uploadImage,
  ]);

  const handleMediaSelected = useCallback((selection: { uri: string; mimeType: string }) => {
    setMediaUri(selection.uri);
    setSelectedMimeType(selection.mimeType);
    setError('');
  }, []);

  const handleMediaClear = useCallback(() => {
    setMediaUri(null);
    setSelectedMimeType('image/jpeg');
    resetUpload();
  }, [resetUpload]);

  const handleTypeSelect = useCallback((option: MomentTypeOption) => {
    setType(option.value);
    if (option.value !== 'goal') {
      setHasTargetDate(false);
    }
    if (option.value !== 'media') {
      setMediaUri(null);
      resetUpload();
    }
    setError('');
  }, [resetUpload]);

  return (
    <KeyboardAvoidingView
      behavior={isIos ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: background }]}
    >
      <ScrollView
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={FadeInDown.duration(Motion.slow).reduceMotion(ReduceMotion.System)}
          style={styles.hero}
        >
          <ThemedText type="display" style={styles.heroTitle}>
            {heroTitle}
          </ThemedText>
          <ThemedText type="body" style={{ color: muted }}>
            {heroSubtitle}
          </ThemedText>
        </Animated.View>

        {showTypePicker ? (
          <View style={styles.typeGrid}>
            {MOMENT_TYPES.map((option, index) => {
              const selected = option.value === type;
              return (
                <Animated.View
                  entering={FadeInDown.duration(Motion.base)
                    .delay(40 + index * 30)
                    .reduceMotion(ReduceMotion.System)}
                  key={option.value}
                  style={[
                    styles.typeCell,
                    index === MOMENT_TYPES.length - 1 && styles.typeCellLast,
                  ]}
                >
                  <Pressable
                    accessibilityLabel={`Moment type ${option.label}`}
                    accessibilityRole="button"
                    onPress={() => handleTypeSelect(option)}
                    style={[
                      styles.typeCard,
                      {
                        borderColor: selected ? accent : border,
                        backgroundColor: selected ? accent : surface,
                      },
                    ]}
                  >
                    <Ionicons
                      color={selected ? onAccent : muted}
                      name={option.icon}
                      size={TYPE_ICON_SIZE}
                    />
                    <ThemedText
                      type="body"
                      style={[
                        styles.typeLabel,
                        { color: selected ? onAccent : text },
                      ]}
                    >
                      {option.label}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: selected ? onAccent : muted }}
                    >
                      {option.description}
                    </ThemedText>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        ) : null}

        <Animated.View
          entering={FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.System)}
          style={styles.contentWrap}
        >
          {isMedia ? (
            <>
              <MediaPicker
                disabled={isSaving}
                onClear={handleMediaClear}
                onMediaSelected={handleMediaSelected}
                selectedUri={mediaUri}
              />
              <UploadProgress
                error={uploadError}
                progress={uploadProgress}
                state={uploadState}
              />
            </>
          ) : null}

          <Surface style={styles.contentSection}>
            <TextInput
              accessibilityLabel="Moment title"
              autoCapitalize="sentences"
              onChangeText={setTitle}
              placeholder="What was it?"
              placeholderTextColor={muted}
              style={[
                styles.titleInput,
                {
                  backgroundColor: surface2,
                  borderColor: border,
                  color: text,
                },
              ]}
              value={title}
            />

            <TextInput
              accessibilityLabel="Moment note"
              autoCapitalize="sentences"
              multiline
              onChangeText={setBody}
              placeholder="The details you'll want later"
              placeholderTextColor={muted}
              style={[
                styles.noteInput,
                {
                  backgroundColor: surface2,
                  borderColor: border,
                  color: text,
                },
              ]}
              textAlignVertical="top"
              value={body}
            />

            {isGoal ? (
              <View style={styles.goalSection}>
                <Pressable
                  accessibilityLabel="Toggle goal target date"
                  accessibilityRole="button"
                  onPress={() =>
                    setHasTargetDate(
                      (currentValue) => !currentValue,
                    )
                  }
                  style={[
                    styles.goalToggle,
                    {
                      borderColor: hasTargetDate
                        ? accent
                        : border,
                      backgroundColor: hasTargetDate
                        ? accent
                        : surface2,
                    },
                  ]}
                >
                  <Ionicons
                    color={hasTargetDate ? onAccent : muted}
                    name={hasTargetDate ? 'calendar' : 'calendar-outline'}
                    size={18}
                    style={styles.goalToggleIcon}
                  />
                  <ThemedText
                    type="caption"
                    style={{
                      color: hasTargetDate
                        ? onAccent
                        : text,
                    }}
                  >
                    {hasTargetDate
                      ? 'Target date enabled'
                      : 'No target date (Someday)'}
                  </ThemedText>
                </Pressable>

                {hasTargetDate ? (
                  <NativeDateTimeField
                    accessibilityLabel="Choose goal target date"
                    label="Target date"
                    mode="date"
                    onChange={setTargetAt}
                    value={targetAt}
                  />
                ) : null}
              </View>
            ) : null}

            <ThemedText type="caption" style={{ color: muted }}>
              {occurredCaption}
            </ThemedText>

            {error ? (
              <ThemedText
                accessibilityRole="alert"
                type="caption"
                style={{ color: danger }}
              >
                {error}
              </ThemedText>
            ) : null}

            {quotaBlocked ? (
              <View style={styles.quotaPanel}>
                <ThemedText type="body">This Space is out of media room.</ThemedText>
                <ThemedText type="caption" style={{ color: muted }}>
                  Aoi Plus raises your shared Space to 5 GiB, your draft stays right here.
                </ThemedText>
                <View style={styles.quotaActions}>
                  <Button
                    label="See Plus"
                    variant="secondary"
                    onPress={() => router.push('/(app)/paywall')}
                  />
                  <Button label="Keep editing" variant="ghost" onPress={() => setQuotaBlocked(false)} />
                </View>
              </View>
            ) : null}
          </Surface>
        </Animated.View>
      </ScrollView>

      <View
        style={[
          footerStyle,
          { borderColor: border, backgroundColor: background },
        ]}
      >
        <Button
          label={
            uploadState === 'uploading'
              ? 'Uploading media…'
              : uploadState === 'confirming'
                ? 'Confirming upload…'
                : isSaving
                  ? submittingLabel
                  : submitLabel
          }
          onPress={handleSave}
          disabled={isSaving}
        />
        <Button
          label="Cancel"
          onPress={onCancel}
          variant="secondary"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  quotaPanel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing[8],
    padding: Spacing[12],
  },
  quotaActions: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[24],
    paddingBottom: Spacing[40],
    gap: Spacing[16],
  },
  hero: {
    gap: Spacing[4],
    paddingBottom: Spacing[8],
  },
  heroTitle: {
    fontSize: 40,
    lineHeight: 46,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  typeCell: {
    width: '48%',
  },
  typeCellLast: {
    flexGrow: 1,
  },
  typeCard: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: Spacing[12],
    gap: Spacing[4],
    justifyContent: 'center',
  },
  typeLabel: {
    fontWeight: '600',
  },
  contentWrap: {
    gap: Spacing[16],
  },
  contentSection: {
    gap: Spacing[12],
  },
  titleInput: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 28,
  },
  noteInput: {
    minHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  goalSection: {
    gap: Spacing[8],
  },
  goalToggle: {
    flexDirection: 'row',
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[12],
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalToggleIcon: {
    marginRight: 6,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[12],
  },
});
