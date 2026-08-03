import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

type UploadState = 'idle' | 'picking' | 'uploading' | 'confirming' | 'done' | 'error';

export type UploadProgressProps = {
  state: UploadState;
  progress: number;
  error?: string | null;
};

const STATE_LABELS: Record<UploadState, string> = {
  idle: '',
  picking: 'Selecting…',
  uploading: 'Uploading media…',
  confirming: 'Confirming upload…',
  done: 'Upload complete',
  error: 'Upload failed',
};

export function UploadProgress({ state, progress, error }: UploadProgressProps) {
  const accent = useThemeColor({}, 'accent');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');

  if (state === 'idle' || state === 'picking') return null;

  const isError = state === 'error';
  const isDone = state === 'done';

  return (
    <Surface style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="meta" style={{ color: isError ? danger : muted }}>
          {isError ? error ?? STATE_LABELS.error : STATE_LABELS[state]}
        </ThemedText>
        {!isDone && !isError && (
          <ThemedText type="caption" style={{ color: muted }}>
            {progress}%
          </ThemedText>
        )}
      </View>
      {!isDone ? (
        <View style={[styles.track, { backgroundColor: surface2, borderColor: border }]}>
          <View
            style={[
              styles.bar,
              {
                backgroundColor: isError ? danger : accent,
                width: `${Math.min(progress, 100)}%`,
              },
            ]}
          />
        </View>
      ) : (
        <ThemedText type="caption" style={{ color: accent }}>
          ✓ Media uploaded
        </ThemedText>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[8],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  track: {
    height: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: Radii.pill,
  },
});
