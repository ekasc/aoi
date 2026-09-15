import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from 'expo-audio';

const MAX_RECORDING_MS = 30_000;

export type VoiceRecorderProps = {
  onRecorded: (uri: string) => void;
  disabled?: boolean;
  compact?: boolean;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
};

function formatElapsed(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * One-tap voice capture: tap to record, tap again to stop. Capped at 30s —
 * a voice trace is a breath, not a voicemail.
 */
export function VoiceRecorder({ onRecorded, disabled, compact, onError, onRecordingChange }: VoiceRecorderProps) {
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recordFailed, setRecordFailed] = useState(false);
  const lastHandledUri = useRef<string | null>(null);

  const handleRecordingStatus = useCallback(
    (status: RecordingStatus) => {
      if (status.isFinished && status.hasError) {
        onError?.('Voice recording failed. Try again?');
        return;
      }
      if (
        status.isFinished &&
        !status.hasError &&
        status.url &&
        status.url !== lastHandledUri.current
      ) {
        lastHandledUri.current = status.url;
        onRecorded(status.url);
      }
    },
    [onRecorded, onError]
  );

  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY,
    handleRecordingStatus
  );
  const recorderState = useAudioRecorderState(recorder, 250);
  const isRecording = recorderState.isRecording;

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      onError?.('Voice recording failed. Try again?');
    }
  }, [recorder, onError]);

  // Auto-stop at the cap.
  useEffect(() => {
    if (isRecording && recorderState.durationMillis >= MAX_RECORDING_MS) {
      void stopRecording();
    }
  }, [isRecording, recorderState.durationMillis, stopRecording]);

  const handlePress = useCallback(async () => {
    if (disabled) {
      return;
    }

    if (isRecording) {
      haptics.tap();
      await stopRecording();
      return;
    }

    setRecordFailed(false);
    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      setPermissionDenied(true);
      onError?.('Microphone access is needed for voice traces.');
      return;
    }

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      haptics.impact();
      recorder.record();
    } catch {
      setRecordFailed(true);
      onError?.('Could not start voice recording. Try again?');
    }
  }, [disabled, isRecording, recorder, stopRecording, onError]);

  if (compact) {
    return (
      <Pressable
        accessibilityLabel={isRecording ? 'Stop recording voice note' : 'Record a voice note'}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => void handlePress()}
        style={[
          styles.recordButton,
          { backgroundColor: isRecording ? danger : surface2 },
          disabled ? styles.disabled : null,
        ]}
      >
        <Ionicons
          color={isRecording ? onAccent : accent}
          name={isRecording ? 'stop' : 'mic-outline'}
          size={20}
        />
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={isRecording ? 'Stop recording voice note' : 'Record a voice note'}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => void handlePress()}
        style={[
          styles.recordButton,
          { backgroundColor: isRecording ? danger : surface2 },
          disabled ? styles.disabled : null,
        ]}
      >
        <Ionicons
          color={isRecording ? onAccent : accent}
          name={isRecording ? 'stop' : 'mic-outline'}
          size={20}
        />
      </Pressable>
      <ThemedText type="caption" style={{ color: muted }}>
        {permissionDenied
          ? 'Microphone access is needed for voice traces.'
          : recordFailed
            ? 'Could not start voice recording. Try again?'
            : isRecording
              ? `${formatElapsed(recorderState.durationMillis)} · tap to stop`
              : 'Voice trace'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
  },
  recordButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  disabled: {
    opacity: 0.5,
  },
});
