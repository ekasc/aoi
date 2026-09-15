import { Image } from 'expo-image';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AudioPlayer } from '@/components/media/audio-player';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useComposer } from '@/features/composer/composer-context';
import type { PendingRecord } from '@/features/composer/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type PendingMemoryRowProps = {
  record: PendingRecord;
  isSending: boolean;
};

function formatTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Private pending preview for the viewer's own unsent memory. Never marked
 * read, never counted as partner unread — the timeline viewability gate
 * only reports kind==='moment' rows, so this row stays invisible to it.
 * A `delivered` row stays until the timeline window renders the real id
 * and the screen acknowledges it (never removed on create alone).
 */
export function PendingMemoryRow({ record, isSending }: PendingMemoryRowProps) {
  const router = useRouter();
  const { retry, editPending, discardPending } = useComposer();
  const muted = useThemeColor({}, 'muted');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');

  const body = record.body.trim();
  const images = record.slots.filter((s) => s.kind === 'image');
  const audios = record.slots.filter((s) => s.kind === 'audio');
  const failed = record.status === 'failed';
  const quotaBlocked = failed && record.errorCode === 'LIMIT_EXCEEDED';
  const statusLabel = isSending || record.status === 'sending'
    ? 'Sending…'
    : record.status === 'queued'
      ? 'Waiting to send'
      : (record.errorMessage ?? 'Could not send yet.');

  const handleRetry = useCallback(() => {
    void retry(record.clientId).catch(() => {});
  }, [retry, record.clientId]);
  const handleEdit = useCallback(() => {
    void editPending(record.clientId).catch(() => {});
  }, [editPending, record.clientId]);
  const handleRemove = useCallback(() => {
    void discardPending(record.clientId).catch(() => {});
  }, [discardPending, record.clientId]);
  const handleSeePlus = useCallback(() => {
    router.push('/(app)/paywall');
  }, [router]);

  return (
    <View
      accessibilityLabel={failed ? 'Memory waiting to send, needs attention' : 'Memory sending'}
      style={[styles.entry, { backgroundColor: surface2, borderColor: border }]}
    >
      <View style={styles.metaRow}>
        <ThemedText type="caption" selectable style={{ color: muted, fontVariant: ['tabular-nums'] }}>
          {formatTimeLabel(record.occurredAt) ? `You · ${formatTimeLabel(record.occurredAt)} · ` : 'You · '}
          {statusLabel}
        </ThemedText>
      </View>
      {body ? <ThemedText type="supporting" selectable>{body}</ThemedText> : null}
      {!body && images.length === 0 && audios.length === 0 ? (
        <ThemedText type="caption" style={{ color: muted }}>Keeping…</ThemedText>
      ) : null}
      {images.length > 0 ? (
        <View style={styles.thumbs}>
          {images.map((slot) => (
            <Image
              key={slot.stagedId}
              accessibilityLabel="Sending photo preview"
              source={{ uri: slot.localUri }}
              style={styles.thumb}
              contentFit="cover"
              transition={200}
            />
          ))}
        </View>
      ) : null}
      {audios.map((slot) => (
        <AudioPlayer key={slot.stagedId} uri={slot.localUri} />
      ))}
      <ThemedText type="caption" style={{ color: muted }}>
        {record.status === 'delivered' ? 'Kept in your story.' : 'Only visible to you until sent.'}
      </ThemedText>
      {failed ? (
        <View style={styles.actions}>
          <Button label="Retry" size="sm" variant="secondary" onPress={handleRetry} />
          <Button label="Edit" size="sm" variant="ghost" onPress={handleEdit} />
          <Pressable
            accessibilityLabel="Remove unsent memory"
            accessibilityRole="button"
            onPress={handleRemove}
            style={styles.removeHit}
          >
            <ThemedText type="body" style={{ color: danger }}>Remove</ThemedText>
          </Pressable>
          {quotaBlocked ? (
            <Button label="See Plus" size="sm" variant="secondary" onPress={handleSeePlus} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    gap: Spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    borderCurve: 'continuous',
    padding: Spacing[12],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  removeHit: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing[8],
  },
});
