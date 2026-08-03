import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
export function VoiceRecorder({ onRecorded, disabled }: VoiceRecorderProps) {
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const lastHandledUri = useRef<string | null>(null);

  const handleRecordingStatus = useCallback(
    (status: RecordingStatus) => {
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
    [onRecorded]
  );

  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY,
    handleRecordingStatus
  );
  const recorderState = useAudioRecorderState(recorder, 250);
  const isRecording = recorderState.isRecording;

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      // Recording failed to stop — nothing tender about surfacing this.
    }
  }, [recorder]);

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
      await stopRecording();
      return;
    }

    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      // Swallow: a failed recording attempt should never interrupt a thought.
    }
  }, [disabled, isRecording, recorder, stopRecording]);

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
