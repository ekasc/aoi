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
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { MediaPicker } from '@/components/media/media-picker';
import { VoiceRecorder } from '@/components/media/voice-recorder';
import { UploadProgress } from '@/components/media/upload-progress';
import { ThemedText } from '@/components/themed-text';
import { Reveal } from '@/components/ui/reveal';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { haptics } from '@/features/haptics/haptics';
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
  /**
   * The recording. The full-screen editor had no voice path at all: the only
   * recorder lived on the Memories inline composer, so a voice memory could
   * be captured in one place and not the other, and this form could only ever
   * carry through a recording that already existed.
   */
  const [audioUri, setAudioUri] = useState<string | null>(initialMoment?.audioUri ?? null);
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
  /**
   * Audio counts. It did not, which meant a voice memory could be opened but
   * not saved: clear the title and body on one and there was nothing left to
   * submit, so the only way out was to type something. For the partner who
   * does not write, that was the whole feature closed off.
   */
  const hasAudio = Boolean(audioUri);
  const canSubmit = hasText || hasMedia || hasAudio;

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
        audioUri,
        clientId: draftClientId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save moment');
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [
    audioUri,
    canSubmit,
    draftClientId,
    hasTargetDate,
    initialMediaPreview,
    initialMoment,
    isGoal,
    mediaUri,
    onSubmit,
    refreshServerPlus,
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
          entering={Reveal.up(Motion.slow)}
          style={styles.hero}
        >
          <ThemedText type="display">
            {heroTitle}
          </ThemedText>
          <ThemedText type="body" style={{ color: muted }}>
            {heroSubtitle}
          </ThemedText>
        </Animated.View>

        {showTypePicker ? (
          <View accessibilityRole="radiogroup" style={styles.typeGrid}>
            {MOMENT_TYPES.map((option, index) => {
              const selected = option.value === type;
              return (
                <Animated.View
                  entering={Reveal.up().delay(Motion.stagger + Reveal.stagger(index))}
                  key={option.value}
                  style={styles.typeCell}
                >
                  <Pressable
                    accessibilityLabel={`Moment type ${option.label}`}
                    accessibilityRole="radio"
                    // The chosen type is the one filled with the accent, and
                    // without this a screen reader announced four identical
                    // buttons with no way to tell which one was active.
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      if (!selected) {
                        haptics.select();
                      }
                      handleTypeSelect(option);
                    }}
                    style={({ pressed }) => [
                      styles.typeCard,
                      {
                        borderColor: selected ? accent : border,
                        backgroundColor: selected ? accent : surface,
                        // The least responsive control in the capture flow:
                        // tapping a type gave no acknowledgement at all.
                        opacity: pressed ? 0.85 : 1,
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
          entering={Reveal.in()}
          exiting={Reveal.out()}
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

          {/* Voice, always offered. It is not an attachment to a text field:
              on its own it is a complete memory, and it is the only path in
              that asks for nothing but a breath. */}
          <View style={styles.voiceSection}>
            <ThemedText type="meta" style={{ color: muted }}>
              {hasAudio ? 'Voice note' : 'Or say it instead'}
            </ThemedText>
            <VoiceRecorder
              compact
              disabled={isSaving}
              onRecorded={(uri) => setAudioUri(uri)}
            />
            {hasAudio ? (
              <Button
                label="Remove voice note"
                onPress={() => setAudioUri(null)}
                size="sm"
                variant="ghost"
              />
            ) : null}
          </View>

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
              <Animated.View entering={Reveal.in()} exiting={Reveal.out()} style={styles.quotaPanel}>
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
              </Animated.View>
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
        {/* One row, cancel left and save right. Stacked full-width buttons
            put two 44pt targets and a 12pt gap across the bottom of the
            capture flow, which is both more chrome than the job needs and
            the platform's own convention for a form's own actions. */}
        <View style={styles.footerActions}>
          <View style={styles.footerCancel}>
            <Button label="Cancel" onPress={onCancel} variant="ghost" />
          </View>
          <View style={styles.footerSave}>
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
              disabled={isSaving}
              onPress={handleSave}
            />
          </View>
        </View>
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
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  typeCell: {
    width: '48%',
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
    ...Typography.inputDisplay,
  },
  noteInput: {
    minHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  voiceSection: {
    gap: Spacing[8],
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
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
  },
  footerCancel: {
    flexGrow: 0,
    flexShrink: 0,
  },
  footerSave: {
    flex: 1,
  },
});
