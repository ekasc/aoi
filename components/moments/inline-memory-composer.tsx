import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AudioPlayer } from '@/components/media/audio-player';
import { VoiceRecorder } from '@/components/media/voice-recorder';
import { DraftMediaGrid } from '@/components/moments/draft-media-grid';
import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { userSafeMessage, useComposer } from '@/features/composer/composer-context';
import { haptics } from '@/features/haptics/haptics';
import { useSubscription } from '@/features/subscription/subscription-context';
import { usePreventLeave } from '@/hooks/use-prevent-leave';
import { useThemeColor } from '@/hooks/use-theme-color';
import { MOMENT_ATTACHMENT_MAX } from '@aoi/shared';

export type ComposerIntent = 'note' | 'photos' | 'camera' | 'voice';

export type InlineMemoryComposerProps = {
  /** Contextual intent from Memories ?compose=… (note focus, photos/camera/voice expand). */
  intent?: string | string[] | null;
  onIntentConsumed?: () => void;
};

function normalizeIntent(raw: string | string[] | null | undefined): ComposerIntent | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === 'note') return 'note';
  if (value === 'photos' || value === 'photo' || value === 'library') return 'photos';
  if (value === 'camera') return 'camera';
  if (value === 'voice') return 'voice';
  return null;
}

function isTodayLocal(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function formatShortDate(date: Date): string {
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function withLocalYMD(baseIso: string, picked: Date): string {
  const base = new Date(baseIso);
  const time = Number.isNaN(base.getTime()) ? new Date() : base;
  const next = new Date(time);
  next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return next.toISOString();
}

export function InlineMemoryComposer({ intent, onIntentConsumed }: InlineMemoryComposerProps) {
  const {
    draft,
    hydrating,
    error: composerError,
    updateBody,
    setOccurredAt,
    addAssets,
    removeAsset,
    save,
    discardDraft,
  } = useComposer();
  const { refreshServerPlus } = useSubscription();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');
  const danger = useThemeColor({}, 'danger');
  const surface2 = useThemeColor({}, 'surface2');
  const isIos = process.env.EXPO_OS === 'ios';
  const isAndroid = process.env.EXPO_OS === 'android';
  // Native sheet chrome on iOS: the Stack header owns Cancel/title/Save via
  // Screen.Title + header toolbars, so the custom top bar below stays for
  // Android/web only (the layout shows the native header on iOS only).
  const useNativeChrome = isIos;
  const reduceMotion = useReducedMotion();

  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [pickerDenied, setPickerDenied] = useState<'library' | 'camera' | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceStaging, setVoiceStaging] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const savingRef = useRef(false);
  const consumedIntentRef = useRef<string | null>(null);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const [allowLeave, setAllowLeave] = useState(false);

  const normalizedIntent = useMemo(() => normalizeIntent(intent), [intent]);

  const draftNonEmpty = !!draft && (draft.body.trim().length > 0 || draft.assets.length > 0);
  const voiceBusy = voiceRecording || voiceStaging;

  // Unsaved content turns any exit — Cancel, native pull-down, Android back —
  // into the discard confirmation instead of a silent drop.
  const handleBlockedLeave = useCallback((leave: () => void) => {
    pendingLeaveRef.current = leave;
    setDiscardVisible(true);
  }, []);
  usePreventLeave(draftNonEmpty && !allowLeave, handleBlockedLeave);

  useLayoutEffect(() => {
    if (!normalizedIntent) return;
    if (consumedIntentRef.current === normalizedIntent) return;
    consumedIntentRef.current = normalizedIntent;
    if (normalizedIntent === 'note') {
      inputRef.current?.focus();
    }
    onIntentConsumed?.();
  }, [normalizedIntent, onIntentConsumed]);

  const handleBodyChange = useCallback((value: string) => {
    setLocalError(null);
    setQuotaBlocked(false);
    void updateBody(value).catch((err) => {
      setLocalError(userSafeMessage(err));
    });
  }, [updateBody]);

  const remaining = draft ? MOMENT_ATTACHMENT_MAX - draft.assets.length : MOMENT_ATTACHMENT_MAX;

  const handlePickLibrary = useCallback(async () => {
    setLocalError(null);
    setPickerDenied(null);
    setQuotaBlocked(false);
    if (!draft || remaining <= 0) {
      setLocalError(`Keep it to ${MOMENT_ATTACHMENT_MAX} photos or voice notes.`);
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickerDenied('library');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) return;
      const descriptors = result.assets.map((asset) => ({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
      }));
      await addAssets(descriptors);
    } catch (err) {
      setLocalError(userSafeMessage(err));
    }
  }, [addAssets, draft, remaining]);

  const handleTakePhoto = useCallback(async () => {
    setLocalError(null);
    setPickerDenied(null);
    setQuotaBlocked(false);
    if (!draft || remaining <= 0) {
      setLocalError(`Keep it to ${MOMENT_ATTACHMENT_MAX} photos or voice notes.`);
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPickerDenied('camera');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      await addAssets([{
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
      }]);
    } catch (err) {
      setLocalError(userSafeMessage(err));
    }
  }, [addAssets, draft, remaining]);

  const handleOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  const handleVoiceRecordingChange = useCallback((recording: boolean) => {
    setVoiceRecording(recording);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setLocalError(message);
  }, []);

  const handleTapRecorded = useCallback((uri: string) => {
    setLocalError(null);
    setVoiceStaging(true);
    void (async () => {
      try {
        await addAssets([{ uri, mimeType: 'audio/m4a' }]);
      } catch (err) {
        setLocalError(userSafeMessage(err));
      } finally {
        setVoiceStaging(false);
      }
    })();
  }, [addAssets]);

  const handleRemoveAsset = useCallback((stagedId: string) => {
    void removeAsset(stagedId).catch((err) => {
      setLocalError(userSafeMessage(err));
    });
  }, [removeAsset]);

  const handlePickDate = useCallback((picked: Date) => {
    if (!draft) return;
    void setOccurredAt(withLocalYMD(draft.occurredAt, picked)).catch((err) => {
      setLocalError(userSafeMessage(err));
    });
  }, [draft, setOccurredAt]);

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

  const handleSave = useCallback(async () => {
    if (!draftNonEmpty || isSaving || savingRef.current || voiceBusy) return;
    savingRef.current = true;
    setIsSaving(true);
    setLocalError(null);
    setQuotaBlocked(false);
    try {
      await save();
      haptics.success();
      router.back();
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'LIMIT_EXCEEDED') {
        void refreshServerPlus().catch(() => {});
        setQuotaBlocked(true);
        haptics.warning();
      } else {
        haptics.error();
      }
      setLocalError(userSafeMessage(err));
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [draftNonEmpty, isSaving, voiceBusy, save, refreshServerPlus, router]);

  const handleDiscard = useCallback(async () => {
    setLocalError(null);
    setQuotaBlocked(false);
    setPickerDenied(null);
    try {
      await discardDraft();
    } catch (err) {
      setLocalError(userSafeMessage(err));
      return;
    }
    haptics.tap();
    // Release the leave guard, then let the effect replay the intercepted
    // exit (a native pull-down or back); Cancel has no action, so it falls
    // back to a plain dismiss.
    setDiscardVisible(false);
    setAllowLeave(true);
  }, [discardDraft]);

  useEffect(() => {
    if (!allowLeave) {
      return;
    }
    const leave = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    if (leave) {
      leave();
    } else {
      router.back();
    }
  }, [allowLeave, router]);

  const handleClose = useCallback(() => {
    if (draftNonEmpty) {
      pendingLeaveRef.current = null;
      setDiscardVisible(true);
      return;
    }
    router.back();
  }, [draftNonEmpty, router]);

  const handleOpenDiscard = useCallback(() => {
    // Opened from the overflow menu, not an exit attempt: discard dismisses.
    pendingLeaveRef.current = null;
    setDiscardVisible(true);
  }, []);

  const handleCloseDiscard = useCallback(() => {
    pendingLeaveRef.current = null;
    setDiscardVisible(false);
  }, []);

  // Photos render as a post-style grid; voice notes stay a player row.
  const imageAssets = useMemo(
    () => (draft?.assets ?? []).filter((asset) => asset.kind === 'image'),
    [draft?.assets]
  );
  const audioAssets = useMemo(
    () => (draft?.assets ?? []).filter((asset) => asset.kind === 'audio'),
    [draft?.assets]
  );

  const canSave = draftNonEmpty && !hydrating && !isSaving && !voiceBusy;
  const combinedError = localError ?? composerError;
  const showQuota = quotaBlocked || (combinedError?.includes('out of media room') ?? false);
  const occurredDate = draft ? new Date(draft.occurredAt) : new Date();
  const validOccurredDate = Number.isNaN(occurredDate.getTime()) ? new Date() : occurredDate;
  const isToday = draft ? isTodayLocal(draft.occurredAt) : true;
  const dateLabel = isToday ? 'Today' : formatShortDate(validOccurredDate);
  const voiceDisabled = remaining <= 0 || isSaving;
  const mediaDisabled = remaining <= 0 || isSaving;

  if (hydrating || !draft) {
    return (
      <View style={styles.loading}>
        <ThemedText type="caption" style={{ color: muted }}>Opening your draft…</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {useNativeChrome ? (
        <>
          <Stack.Screen.Title>New memory</Stack.Screen.Title>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button onPress={handleClose}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              disabled={!canSave}
              onPress={() => void handleSave()}
              variant="done"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : (
        <View style={[styles.topBar, { paddingTop: insets.top + Spacing[8] }]}>
          <Button label="Cancel" variant="ghost" size="sm" onPress={handleClose} />
          <ThemedText type="bodyEmphasis" numberOfLines={1} style={styles.headerTitle}>New memory</ThemedText>
          <Button
            accessibilityHint="Save this memory"
            disabled={!canSave}
            label={isSaving ? 'Saving…' : 'Save'}
            size="sm"
            onPress={() => void handleSave()}
          />
        </View>
      )}

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel="Keep something"
          autoFocus
          multiline
          onChangeText={handleBodyChange}
          placeholderTextColor={muted}
          scrollEnabled={false}
          style={[styles.input, { color: text }]}
          value={draft.body}
        />

        {/*
          The prompt stays mounted and fades: unmounting it on the first
          keystroke shifted the rows below and flickered the sheet.
        */}
        <ThemedText
          accessibilityElementsHidden={draftNonEmpty}
          importantForAccessibility={draftNonEmpty ? 'no-hide-descendants' : 'auto'}
          testID="composer-empty-hint"
          type="supporting"
          style={[styles.emptyHint, { color: muted, opacity: draftNonEmpty ? 0 : 1 }]}
        >
          Something small from today — a photo, a line, a sound.
        </ThemedText>

        {imageAssets.length > 0 ? (
          <DraftMediaGrid assets={imageAssets} onRemove={handleRemoveAsset} />
        ) : null}

        {audioAssets.length > 0 ? (
          <View style={styles.audioList}>
            {audioAssets.map((asset, index) => (
              <View
                key={asset.stagedId}
                style={[styles.audioRow, { borderColor: border }]}
              >
                <View style={styles.audioPreview}>
                  <AudioPlayer uri={asset.localUri} />
                </View>
                <Pressable
                  accessibilityLabel={`Remove voice note ${index + 1}`}
                  accessibilityRole="button"
                  onPress={() => handleRemoveAsset(asset.stagedId)}
                  style={styles.audioRemove}
                >
                  <Ionicons color={muted} name="close-circle" size={22} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {pickerDenied ? (
          <View style={styles.inlineError}>
            <ThemedText type="caption" style={{ color: muted }}>
              {pickerDenied === 'camera' ? 'Camera' : 'Photo library'} access is needed to attach photos.
            </ThemedText>
            <Button label="Open Settings" size="sm" variant="secondary" onPress={handleOpenSettings} />
          </View>
        ) : null}

        {combinedError ? (
          <ThemedText
            accessibilityLiveRegion="polite"
            selectable
            type="caption"
            style={{ color: danger }}
          >
            {combinedError}
          </ThemedText>
        ) : null}
        {showQuota ? (
          <View style={[styles.quota, { borderColor: border }]}>
            <ThemedText type="body">This Space is out of media room.</ThemedText>
            <ThemedText type="caption" style={{ color: muted }}>
              Aoi Plus raises your shared Space. Your draft stays right here.
            </ThemedText>
            <View style={styles.quotaActions}>
              <Button label="See Plus" size="sm" variant="secondary" onPress={() => router.push('/(app)/paywall')} />
              <Button label="Keep editing" size="sm" variant="ghost" onPress={() => setQuotaBlocked(false)} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {datePickerVisible ? (
        isIos ? (
          reduceMotion ? (
            <View style={[styles.datePickerCard, { borderColor: border, backgroundColor: surface2 }]}>
              <DateTimePicker
                display="spinner"
                mode="date"
                onChange={handleDatePickerChange}
                value={validOccurredDate}
              />
              <Button
                label="Done"
                onPress={handleCloseDatePicker}
                size="sm"
                variant="secondary"
              />
            </View>
          ) : (
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 200 }}
              style={[styles.datePickerCard, { borderColor: border, backgroundColor: surface2 }]}
            >
              <DateTimePicker
                display="spinner"
                mode="date"
                onChange={handleDatePickerChange}
                value={validOccurredDate}
              />
              <Button
                label="Done"
                onPress={handleCloseDatePicker}
                size="sm"
                variant="secondary"
              />
            </MotiView>
          )
        ) : (
          <DateTimePicker
            display="default"
            mode="date"
            onChange={handleDatePickerChange}
            value={validOccurredDate}
          />
        )
      ) : null}

      <View style={[styles.toolbar, { borderColor: border, paddingBottom: insets.bottom + Spacing[8] }]}>
        <IconButton
          accessibilityHint="Choose photos from your library"
          disabled={mediaDisabled}
          label="Choose photos"
          onPress={() => void handlePickLibrary()}
          variant="secondary"
        >
          <Ionicons color={muted} name="image-outline" size={20} />
        </IconButton>
        <IconButton
          accessibilityHint="Take a photo now"
          disabled={mediaDisabled}
          label="Take a photo"
          onPress={() => void handleTakePhoto()}
          variant="secondary"
        >
          <Ionicons color={muted} name="camera-outline" size={20} />
        </IconButton>
        <VoiceRecorder
          compact
          disabled={voiceDisabled}
          onError={handleVoiceError}
          onRecorded={handleTapRecorded}
          onRecordingChange={handleVoiceRecordingChange}
        />
        <Pressable
          accessibilityLabel="Choose memory date"
          accessibilityRole="button"
          onPress={handleToggleDatePicker}
          style={[styles.dateChip, { borderColor: border }]}
        >
          <Ionicons color={muted} name="calendar-outline" size={16} />
          <ThemedText type="caption" numberOfLines={1} style={styles.dateLabel}>
            {dateLabel}
          </ThemedText>
        </Pressable>
        {draftNonEmpty ? (
          <Pressable
            accessibilityLabel="More options"
            accessibilityHint="Discard draft"
            accessibilityRole="button"
            onPress={handleOpenDiscard}
            style={styles.moreButton}
          >
            <Ionicons color={muted} name="ellipsis-horizontal" size={20} />
          </Pressable>
        ) : null}
      </View>

      <ActionSheet
        actions={[
          {
            label: 'Discard draft',
            onPress: () => void handleDiscard(),
            variant: 'destructive',
            icon: 'trash-outline',
          },
          { label: 'Keep editing', onPress: handleCloseDiscard, icon: 'pencil-outline' },
        ]}
        description="Your words and photos will be lost."
        onClose={handleCloseDiscard}
        title="Discard this memory?"
        visible={discardVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing[16],
    gap: Spacing[8],
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[16],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: Spacing[8],
  },
  headerTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 17,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    gap: Spacing[12],
    paddingVertical: Spacing[8],
  },
  input: {
    // Display serif like the letter editor: writing should feel like
    // writing, content first. No fixed tall box — the empty hint sits
    // right under the first line instead of a 240pt void.
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 32,
    letterSpacing: -0.2,
    minHeight: 44,
    paddingVertical: Spacing[8],
    textAlignVertical: 'top',
  },
  emptyHint: {
    // Kept in flow (faded, not unmounted) so the first keystroke doesn't
    // shift the rows below.
    minHeight: 20,
  },
  audioList: {
    gap: Spacing[8],
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    borderCurve: 'continuous',
    padding: Spacing[8],
  },
  audioPreview: {
    flex: 1,
  },
  audioRemove: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineError: {
    gap: Spacing[8],
  },
  quota: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.card,
    borderCurve: 'continuous',
    gap: Spacing[8],
    padding: Spacing[12],
  },
  quotaActions: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  datePickerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.sheet,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[8],
    gap: Spacing[8],
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing[8],
  },
  dateChip: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing[12],
    justifyContent: 'center',
  },
  dateLabel: {
    flexShrink: 1,
  },
  moreButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
