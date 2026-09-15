import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useMoments } from '@/features/moments/moments-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export const VOICE_BAR_COUNT = 28;
export const VOICE_MAX_RECORDING_MS = 30_000;
const VOICE_BAR_STATIC_SCALE = 0.4;
const VOICE_RELEASE_HINT = 'Release to finish';

// Waveform source (installed expo-audio 57.0.4, verified in its Audio.types):
// RecordingOptions.isMeteringEnabled feeds live dB levels into
// RecorderState.metering, polled here via useAudioRecorderState. Bars scale
// from that real level; while metering is absent (first poll, unsupported
// surface) bars rest at a quiet baseline. No simulated audio, no dB numbers
// in the UI.
export function meteringToLevel(metering: number | undefined): number {
  if (metering === undefined || !Number.isFinite(metering)) {
    return 0.12;
  }
  // metering is dBFS (<= 0; silence floors around -50 on device).
  const normalized = (metering + 50) / 50;
  return Math.min(1, Math.max(0.12, normalized));
}

function barScaleForLevel(level: number, index: number): number {
  // Deterministic per-bar taper so one live level reads as a waveform row.
  const taper = 0.55 + 0.45 * Math.abs(Math.sin(index * 1.7));
  return Math.min(1, Math.max(0.08, level * taper + 0.06));
}

export function formatVoiceElapsed(totalSeconds: number): string {
  const capped = Math.min(Math.max(0, totalSeconds), 30);
  const minutes = Math.floor(capped / 60);
  const seconds = capped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export type VoiceHoldOverlayProps = {
  visible: boolean;
  holding: boolean;
  onClose: () => void;
  onPermissionDenied: () => void;
};

type VoicePhase = 'idle' | 'starting' | 'recording' | 'review';

/**
 * Fullscreen press-and-hold voice capture. The parent owns the hold gesture
 * (Voice button onPressIn/onPressOut) and passes it down as `holding`; this
 * overlay owns the recording engine, the live metered waveform, and the
 * release-to-review send/discard row. No replay, no caption.
 */
export function VoiceHoldOverlay({
  visible,
  holding,
  onClose,
  onPermissionDenied,
}: VoiceHoldOverlayProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { addMoment } = useMoments();
  const overlay = useThemeColor({}, 'overlay');
  const text = useThemeColor({}, 'textPrimary');
  const muted = useThemeColor({}, 'muted');
  const accent = useThemeColor({}, 'accent');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const onAccent = useThemeColor({}, 'onAccent');
  const danger = useThemeColor({}, 'danger');

  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const finishingRef = useRef(false);
  const sessionRef = useRef(false);
  const lastHandledUri = useRef<string | null>(null);
  const holdingRef = useRef(holding);
  useEffect(() => {
    holdingRef.current = holding;
  }, [holding]);

  const handleRecordingStatus = useCallback((status: RecordingStatus) => {
    if (status.isFinished && !status.hasError && status.url && status.url !== lastHandledUri.current) {
      lastHandledUri.current = status.url;
      setVoiceUri(status.url);
      setPhase('review');
      setError('');
    } else if (status.isFinished && (status.hasError || !status.url)) {
      // Capture failed (e.g. ultra-short tap): fall through to review with
      // discard only — no send without audio, no extra copy.
      setPhase('review');
    }
  }, []);

  const recorder = useAudioRecorder(
    { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true },
    handleRecordingStatus
  );
  const recorderState = useAudioRecorderState(recorder, 250);

  const finishRecording = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    setPhase('review');
    try {
      await recorder.stop();
    } catch {
      // Stopping must never trap the overlay; review offers discard.
    }
  }, [recorder]);

  const beginRecording = useCallback(async () => {
    setPhase('starting');
    setElapsedSecs(0);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      // sessionRef stays set while visible so the start effect cannot
      // re-fire; the hide watcher below re-arms the next open.
      setPhase('idle');
      onPermissionDenied();
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      if (!holdingRef.current) {
        // Finger already lifted during the async start: stop right away.
        await finishRecording();
        return;
      }
      setPhase('recording');
    } catch {
      // A failed start stays idle — close quietly, keep no draft (same
      // no-refire guard as the denied path above).
      setPhase('idle');
      onClose();
    }
  }, [finishRecording, onClose, onPermissionDenied, recorder]);

  useEffect(() => {
    if (!visible || !holding || sessionRef.current) {
      return;
    }
    sessionRef.current = true;
    finishingRef.current = false;
    void beginRecording();
  }, [beginRecording, holding, visible]);

  // Re-arm the next open on hide. Refs only (no setState): the next begin
  // re-establishes phase/elapsed at its top, and discard/save already clear
  // their own draft state before closing.
  useEffect(() => {
    if (!visible) {
      sessionRef.current = false;
      finishingRef.current = false;
      savingRef.current = false;
      lastHandledUri.current = null;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !sessionRef.current || phase !== 'recording') {
      return;
    }
    if (!holding || recorderState.durationMillis >= VOICE_MAX_RECORDING_MS) {
      void finishRecording();
    }
  }, [finishRecording, holding, phase, recorderState.durationMillis, visible]);

  useEffect(() => {
    if (!visible || phase !== 'recording') {
      return;
    }
    const timer = setInterval(() => {
      setElapsedSecs((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, visible]);

  const handleDiscard = useCallback(() => {
    lastHandledUri.current = null;
    setVoiceUri(null);
    setElapsedSecs(0);
    setError('');
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!voiceUri || isSaving || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError('');
    try {
      const saved = await addMoment({
        type: 'trace',
        title: '',
        body: '',
        occurredAt: new Date().toISOString(),
        audioUri: voiceUri,
      });
      setVoiceUri(null);
      setElapsedSecs(0);
      lastHandledUri.current = null;
      setError('');
      onClose();
      router.replace({
        pathname: '/(app)/moment/[id]' as const,
        params: { id: saved.id, at: saved.occurredAt, returnTo: 'us' },
      });
    } catch {
      setError('Could not keep this voice note. Please try again.');
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [addMoment, isSaving, onClose, router, voiceUri]);

  const bars = useMemo(() => {
    const level = meteringToLevel(recorderState.metering);
    return Array.from({ length: VOICE_BAR_COUNT }, (_, index) => {
      const scale = reduceMotion ? VOICE_BAR_STATIC_SCALE : barScaleForLevel(level, index);
      return (
        <View
          key={index}
          testID={`voice-bar-${index}`}
          style={[
            styles.bar,
            {
              backgroundColor: index % 2 === 0 ? accent : partnerAccent,
              transform: [{ scaleY: scale }],
            },
          ]}
        />
      );
    });
  }, [accent, partnerAccent, recorderState.metering, reduceMotion]);

  const contentStyle = useMemo(
    () => [
      styles.content,
      {
        paddingTop: insets.top + Spacing[24],
        paddingBottom: insets.bottom + Spacing[32],
        paddingHorizontal: Spacing[16],
      },
    ],
    [insets.bottom, insets.top]
  );

  if (!visible) {
    return null;
  }

  const recording = phase === 'starting' || phase === 'recording';

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleDiscard}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <BlurView intensity={56} style={StyleSheet.absoluteFill} tint="default" />
        <View pointerEvents="none" style={[styles.dim, { backgroundColor: overlay }]} />
        <View accessibilityViewIsModal style={contentStyle}>
          {recording ? (
            <View
              accessibilityLabel="Recording voice note. Release to finish."
              style={styles.center}
            >
              <ThemedText accessible={false} style={[styles.timer, { color: text }]}>
                {formatVoiceElapsed(elapsedSecs)}
              </ThemedText>
              <View
                testID="voice-waveform"
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.waveform}
              >
                {bars}
              </View>
              <ThemedText type="caption" style={{ color: muted }}>
                {VOICE_RELEASE_HINT}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.center} accessibilityLabel="Voice note ready to send.">
              <ThemedText accessible={false} style={[styles.timer, { color: text }]}>
                {formatVoiceElapsed(elapsedSecs)}
              </ThemedText>
              {error ? (
                <ThemedText type="caption" style={{ color: danger }}>
                  {error}
                </ThemedText>
              ) : null}
              <View style={styles.actions}>
                {voiceUri ? (
                  <Pressable
                    accessibilityLabel="Send voice note"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isSaving }}
                    disabled={isSaving}
                    onPress={() => void handleSave()}
                    style={[styles.sendButton, { backgroundColor: accent, opacity: isSaving ? 0.5 : 1 }]}
                  >
                    <Ionicons color={onAccent} name="arrow-up" size={22} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityLabel="Discard voice note"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleDiscard}
                  style={styles.discard}
                >
                  <Ionicons color={muted} name="close" size={20} />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  dim: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[16],
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[16],
    width: '100%',
  },
  timer: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '600',
    textAlign: 'center',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 64,
    width: '100%',
    maxWidth: 320,
  },
  bar: {
    width: 4,
    height: 48,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[16],
  },
  sendButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
  },
  discard: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
    borderRadius: Radii.pill,
  },
});
