import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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
import { DraftMediaGrid } from '@/components/moments/draft-media-grid';
import { ThemedText } from '@/components/themed-text';
import { Reveal } from '@/components/ui/reveal';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Radii, Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { haptics } from '@/features/haptics/haptics';
import type { StagedAsset } from '@/features/composer/types';
import { newDraftClientId } from '@/features/moments/draft-identity';
import { MOMENT_LOCALE } from '@/features/moments/labels';
import { isQuotaExceededError, useMediaUpload } from '@/features/media/use-media-upload';
import { useSubscription } from '@/features/subscription/subscription-context';
import type { Moment, MomentAttachmentInput, MomentType } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';
import { MOMENT_ATTACHMENT_MAX } from '@aoi/shared';

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

type EditPhoto = {
  /** Stable key: the server media id when known, else the uri. */
  key: string;
  uri: string;
  mimeType: string;
  /** Null for legacy preview-only media and freshly picked photos. */
  mediaId: string | null;
  /** True for photos picked in this session — uploaded on save. */
  isNew: boolean;
};

/**
 * Edit-mode photo set, newest composition first-class: ordered attachment
 * images win, the legacy single preview fills in for old moments.
 */
function initialEditPhotos(moment?: Moment): EditPhoto[] {
  if (!moment) {
    return [];
  }
  const images = (moment.attachments ?? []).filter(
    (attachment) => attachment.kind === 'image',
  );
  if (images.length > 0) {
    return images.map((attachment, index) => ({
      key: attachment.mediaId ?? `${attachment.url}#${index}`,
      uri: attachment.url,
      mimeType: 'image/jpeg',
      mediaId: attachment.mediaId ?? null,
      isNew: false,
    }));
  }
  if (moment.mediaPreview) {
    return [
      {
        key: moment.mediaId ?? moment.mediaPreview,
        uri: moment.mediaPreview,
        mimeType: 'image/jpeg',
        mediaId: moment.mediaId ?? null,
        isNew: false,
      },
    ];
  }
  return [];
}

function isTodayLocal(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatShortDate(date: Date): string {
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(MOMENT_LOCALE, {
      month: 'short',
      day: 'numeric',
    });
  }
  return date.toLocaleDateString(MOMENT_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Keep the clock time, replace the calendar day — same rule as capture. */
function withLocalYMD(baseIso: string, picked: Date): string {
  const base = new Date(baseIso);
  const time = Number.isNaN(base.getTime()) ? new Date() : base;
  const next = new Date(time);
  next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return next.toISOString();
}

export type MomentFormValues = {
  expectedUpdatedAt?: string;
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
   * Ordered photo replacement (edit mode only, `{ mediaId, kind }` — never
   * device URIs). Omitted = the stored photo set is untouched; supplied
   * (even `[]` to clear) = atomically replace it, exactly like the update
   * path treats it.
   */
  attachments?: MomentAttachmentInput[];
  /**
   * Opaque per-draft idempotency key (create mode only). One id per draft
   * instance, stable across retries and edits, so a double-tap on Save
   * replays server-side instead of creating two moments.
   */
  clientId?: string;
};

export type MomentFormProps = {
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
 * The shared capture/edit form. Edit mode (behind `moment/edit/[id]`) reads
 * like the capture it revises — one serif body, the photo grid, an editable
 * date chip, the stored type locked — and preserves audioUri untouched.
 */
export function MomentForm({
  heroSubtitle,
  submitLabel,
  submittingLabel,
  initialMoment: initialMomentProp,
  defaultType,
  hideTypePicker,
  onSubmit,
  onCancel,
}: MomentFormProps) {
  const [initialMoment] = useState(initialMomentProp);
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

  // Revisiting, not re-capturing: the stored type, title, and photo set are
  // the starting point, and the type is never re-asked.
  const isEdit = Boolean(initialMoment);
  const [type, setType] = useState<MomentType>(initialMoment?.type ?? defaultType ?? 'note');
  const [title, setTitle] = useState(initialMoment?.title ?? '');
  const [body, setBody] = useState(initialMoment?.body ?? '');
  const [occurredAt, setOccurredAt] = useState(
    () => initialMoment?.occurredAt ?? new Date().toISOString(),
  );
  const [initialPhotoKeys] = useState<string[]>(
    () => initialEditPhotos(initialMoment).map((photo) => photo.key),
  );
  const [photos, setPhotos] = useState<EditPhoto[]>(() => initialEditPhotos(initialMoment));
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [pickerDenied, setPickerDenied] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
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
  // Photo picking runs through the same guard: the sheet is async, and a
  // second tap while it is open must not stack another one.
  const pickerBusyRef = useRef(false);
  const photoKeyRef = useRef(0);
  const isAndroid = process.env.EXPO_OS === 'android';

  // The type is decided once, at capture. Editing never re-asks — the
  // stored type flows to the update call unchanged. Callers (e.g. Plans
  // goal capture) can lock any fixed type the same way.
  const showTypePicker = !isEdit && !hideTypePicker;

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const isMedia = type === 'media';
  const isGoal = type === 'goal';
  // Capture gates its single slot on the media type; revisiting keeps
  // whatever the memory already carries, whatever its type.
  const hasMedia = isEdit ? photos.length > 0 : isMedia && !!mediaUri;
  // The title box is a capture affordance. In edit mode the single body
  // carries the words and the stored title flows through untouched.
  const hasText = isEdit
    ? trimmedBody.length > 0
    : trimmedTitle.length > 0 || trimmedBody.length > 0;
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
    return `Today · ${new Date().toLocaleDateString('en-US')}`;
  }, []);

  const occurredDate = useMemo(() => {
    const parsed = new Date(occurredAt);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [occurredAt]);
  const dateLabel = isTodayLocal(occurredAt) ? 'Today' : formatShortDate(occurredDate);

  // Grid tiles render through the same contract as capture.
  const editImageAssets: StagedAsset[] = useMemo(
    () =>
      photos.map((photo) => ({
        stagedId: photo.key,
        kind: 'image' as const,
        mimeType: photo.mimeType,
        localUri: photo.uri,
      })),
    [photos],
  );
  const photosDirty =
    photos.length !== initialPhotoKeys.length ||
    photos.some((photo, index) => photo.key !== initialPhotoKeys[index]);
  const remainingPhotos = MOMENT_ATTACHMENT_MAX - photos.length;

  const handleSave = useCallback(async () => {
    if (!canSubmit) {
      setError(
        isEdit
          ? 'Add a note, photo, or voice note before saving.'
          : 'Add a title, note, or media before saving.',
      );
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
      let attachments: MomentAttachmentInput[] | undefined;

      if (isEdit) {
        if (photos.length > 0) {
          const resolved: { mediaId: string | null; url: string }[] = [];
          for (const photo of photos) {
            if (photo.mediaId) {
              resolved.push({ mediaId: photo.mediaId, url: photo.uri });
              continue;
            }
            if (!photo.isNew) {
              // Legacy preview-only media carries through untouched, never
              // re-uploaded — same as the single-slot path below.
              resolved.push({ mediaId: null, url: photo.uri });
              continue;
            }
            try {
              const uploaded = await uploadImage({ uri: photo.uri, mimeType: photo.mimeType });
              // Stable URL + stable media id; the presigned URL never leaves
              // the upload flow.
              resolved.push({ mediaId: uploaded.mediaId, url: uploaded.url });
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
          const first = resolved[0];
          mediaPreview = first ? first.url : null;
          mediaId = first ? first.mediaId : null;
          // The ordered set needs a server id per photo. Without one (stub
          // uploads, legacy previews) the legacy first-photo fields carry
          // the edit and the stored set is left alone.
          const withIds = resolved.filter(
            (entry): entry is { mediaId: string; url: string } => entry.mediaId !== null,
          );
          if (photosDirty && resolved.length > 0 && withIds.length === resolved.length) {
            attachments = withIds.map((entry) => ({
              mediaId: entry.mediaId,
              kind: 'image' as const,
            }));
          }
        } else if (photosDirty) {
          // Every photo removed: clear the stored set, not just the preview.
          attachments = [];
        }
      } else if (mediaUri) {
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
        expectedUpdatedAt: initialMoment?.updatedAt ?? initialMoment?.createdAt,
        type,
        title: isEdit ? (initialMoment?.title ?? '') : trimmedTitle,
        body: trimmedBody,
        occurredAt,
        targetAt: isGoal && hasTargetDate ? targetAt.toISOString() : null,
        mediaPreview,
        mediaId,
        audioUri,
        ...(attachments !== undefined ? { attachments } : {}),
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
    isEdit,
    isGoal,
    mediaUri,
    occurredAt,
    onSubmit,
    photos,
    photosDirty,
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

  const handleOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  const appendPickedPhotos = useCallback(
    (assets: { uri: string; mimeType?: string | null }[]) => {
      setPhotos((current) => {
        const room = MOMENT_ATTACHMENT_MAX - current.length;
        const fresh = assets.slice(0, Math.max(room, 0)).map((asset) => {
          photoKeyRef.current += 1;
          return {
            key: `local_${Date.now()}_${photoKeyRef.current}_${asset.uri}`,
            uri: asset.uri,
            mimeType: asset.mimeType ?? 'image/jpeg',
            mediaId: null,
            isNew: true,
          };
        });
        return [...current, ...fresh];
      });
      setError('');
      setQuotaBlocked(false);
    },
    [],
  );

  const handlePickLibrary = useCallback(async () => {
    if (pickerBusyRef.current || isSaving) {
      return;
    }
    const remaining = MOMENT_ATTACHMENT_MAX - photos.length;
    setError('');
    setPickerDenied(false);
    setQuotaBlocked(false);
    if (remaining <= 0) {
      setError(`Keep it to ${MOMENT_ATTACHMENT_MAX} photos.`);
      return;
    }
    try {
      pickerBusyRef.current = true;
      setPickerBusy(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) {
        return;
      }
      appendPickedPhotos(result.assets);
    } catch {
      setError('Could not add those photos. Please try again.');
    } finally {
      pickerBusyRef.current = false;
      setPickerBusy(false);
    }
  }, [appendPickedPhotos, isSaving, photos.length]);

  const handleTakePhoto = useCallback(async () => {
    if (pickerBusyRef.current || isSaving) {
      return;
    }
    const remaining = MOMENT_ATTACHMENT_MAX - photos.length;
    setError('');
    setPickerDenied(false);
    setQuotaBlocked(false);
    if (remaining <= 0) {
      setError(`Keep it to ${MOMENT_ATTACHMENT_MAX} photos.`);
      return;
    }
    try {
      pickerBusyRef.current = true;
      setPickerBusy(true);
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPickerDenied(true);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      if (!asset) {
        return;
      }
      appendPickedPhotos([asset]);
    } catch {
      setError('Could not add that photo. Please try again.');
    } finally {
      pickerBusyRef.current = false;
      setPickerBusy(false);
    }
  }, [appendPickedPhotos, isSaving, photos.length]);

  const handleRemovePhoto = useCallback((stagedId: string) => {
    setPhotos((current) => current.filter((photo) => photo.key !== stagedId));
    setError('');
  }, []);

  const handlePickDate = useCallback((picked: Date) => {
    setOccurredAt((current) => withLocalYMD(current, picked));
    setError('');
  }, []);

  const handleDatePickerChange = useCallback((event: DateTimePickerEvent, selected?: Date) => {
    if (isAndroid) {
      setDatePickerVisible(false);
    }
    if (event.type === 'dismissed' || !selected) {
      return;
    }
    handlePickDate(selected);
  }, [handlePickDate, isAndroid]);

  const handleToggleDatePicker = useCallback(() => {
    setDatePickerVisible((current) => !current);
  }, []);

  const handleCloseDatePicker = useCallback(() => {
    setDatePickerVisible(false);
  }, []);

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
          {isEdit ? (
            <>
              <TextInput
                accessibilityLabel="Moment note"
                autoCapitalize="sentences"
                editable={!isSaving}
                multiline
                onChangeText={setBody}
                placeholder="The details you'll want later"
                placeholderTextColor={muted}
                style={[styles.editBodyInput, { color: text }]}
                textAlignVertical="top"
                value={body}
              />

              {photos.length > 0 ? (
                <DraftMediaGrid assets={editImageAssets} onRemove={handleRemovePhoto} />
              ) : null}

              <View style={styles.photoSection}>
                <ThemedText type="meta" style={{ color: muted }}>
                  {photos.length > 0 ? 'Photos' : 'Add photos'}
                </ThemedText>
                <View style={styles.photoActions}>
                  <Button
                    disabled={isSaving || pickerBusy || remainingPhotos <= 0}
                    label="Choose photos"
                    onPress={() => void handlePickLibrary()}
                    size="sm"
                    variant="secondary"
                  />
                  <Button
                    disabled={isSaving || pickerBusy || remainingPhotos <= 0}
                    label="Take a photo"
                    onPress={() => void handleTakePhoto()}
                    size="sm"
                    variant="secondary"
                  />
                </View>
                {pickerDenied ? (
                  <View style={styles.inlineError}>
                    <ThemedText type="caption" style={{ color: muted }}>
                      Camera access is needed to attach photos.
                    </ThemedText>
                    <Button label="Open Settings" size="sm" variant="secondary" onPress={handleOpenSettings} />
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {!isEdit && isMedia ? (
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
            {!isEdit ? (
              <>
                <TextInput
                  accessibilityLabel="Moment title"
                  autoCapitalize="sentences"
                  onChangeText={setTitle}
                  placeholder={isGoal ? "What are you hoping for?" : "What was it?"}
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
                  placeholder={isGoal ? "What will make it good?" : "The details you'll want later"}
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
              </>
            ) : null}

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
                    textColor={text}
                    value={targetAt}
                  />
                ) : null}
              </View>
            ) : null}

            {!isEdit ? (
              <ThemedText type="caption" style={{ color: muted }}>
                {isGoal
                  ? hasTargetDate
                    ? `Aiming for ${formatShortDate(targetAt)}`
                    : 'No target date — lives in Someday'
                  : occurredCaption}
              </ThemedText>
            ) : null}

            {isEdit ? (
              <>
                <Pressable
                  accessibilityLabel="Choose memory date"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSaving }}
                  disabled={isSaving}
                  onPress={handleToggleDatePicker}
                  style={[styles.dateChip, { borderColor: border }]}
                >
                  <Ionicons color={muted} name="calendar-outline" size={16} />
                  <ThemedText type="caption" numberOfLines={1} style={styles.dateLabel}>
                    {dateLabel}
                  </ThemedText>
                </Pressable>

                {datePickerVisible ? (
                  isIos ? (
                    <Animated.View
                      entering={Reveal.in()}
                      exiting={Reveal.out()}
                      style={[styles.datePickerCard, { borderColor: border, backgroundColor: surface2 }]}
                    >
                      <DateTimePicker
                        display="spinner"
                        mode="date"
                        onChange={handleDatePickerChange}
                        value={occurredDate}
                      />
                      <Button
                        label="Done"
                        onPress={handleCloseDatePicker}
                        size="sm"
                        variant="secondary"
                      />
                    </Animated.View>
                  ) : (
                    <DateTimePicker
                      display="default"
                      mode="date"
                      onChange={handleDatePickerChange}
                      value={occurredDate}
                    />
                  )
                ) : null}
              </>
            ) : null}

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
  // Revisiting reads like capture: the words sit on the surface in the
  // serif, content first — no field box around them.
  editBodyInput: {
    ...Typography.inputDisplay,
    minHeight: 44,
    paddingVertical: Spacing[8],
    textAlignVertical: 'top',
  },
  photoSection: {
    gap: Spacing[8],
  },
  photoActions: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  inlineError: {
    gap: Spacing[8],
  },
  dateChip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing[12],
  },
  dateLabel: {
    flexShrink: 1,
  },
  datePickerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[8],
    gap: Spacing[8],
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
