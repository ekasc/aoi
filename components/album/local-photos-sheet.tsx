import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Radii, Spacing } from '@/constants/theme';
import type { useSkyPhotos } from '@/features/album/use-sky-photos';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';
import { useThemeColor } from '@/hooks/use-theme-color';

export function LocalPhotosSheet({ visible, onClose, album }: {
  visible: boolean;
  onClose: () => void;
  album: ReturnType<typeof useSkyPhotos>;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const muted = useThemeColor({}, 'textSecondary');
  const border = useThemeColor({}, 'border');
  const busy = album.operation !== null;
  return (
    <NativeSheet visible={visible} onClose={onClose} dismissible={!busy}>
      <FlatList accessibilityViewIsModal accessibilityLabel="Local photo copies" role="dialog" aria-modal
        style={{ maxHeight: height * 0.8 }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[32] }]}
        data={album.photos} keyExtractor={(photo) => photo.id}
        ListHeaderComponent={<View style={styles.section}>
        <ThemedText type="title">Local photo copies</ThemedText>
        <ThemedText type="body">These photos are not part of your shared archive. To share a photo with your partner, keep it in Memories.</ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          Copies stay on this device. Aoi does not upload or share them. Removing a copy here does not delete the original from your gallery.
        </ThemedText>
        {album.status === 'loading' ? <ThemedText accessibilityLiveRegion="polite">Opening your local photos…</ThemedText> : null}
        {album.readError ? <ThemedText accessibilityRole="alert">{album.readError}</ThemedText> : null}
        {album.status === 'failed' ? <Button label="Try again" onPress={album.reload} variant="secondary" disabled={busy} /> : null}
        {album.status === 'ready' && album.photos.length === 0 ? <ThemedText>No photos selected yet.</ThemedText> : null}
        </View>}
        renderItem={({ item: photo, index }) => (
          <LocalPhotoRow key={`${photo.id}:${photo.uri}`} photo={photo} index={index} busy={busy} border={border} onRemove={album.removePhoto} />
        )}
        ListFooterComponent={<View style={styles.section}>
        {album.operation === 'removing' ? <ThemedText accessibilityLiveRegion="polite">Removing local copy…</ThemedText> : null}
        {album.actionError ? <ThemedText accessibilityRole="alert">{album.actionError}</ThemedText> : null}
        <Button label={album.operation === 'importing' ? 'Adding photos…' : 'Choose photos'} onPress={album.choosePhotos}
          disabled={busy || album.status !== 'ready'} accessibilityState={{ busy: album.operation === 'importing', disabled: busy || album.status !== 'ready' }} accessibilityLiveRegion="polite" />
        <Button label="Done" variant="secondary" onPress={onClose} disabled={busy} />
        </View>}
      />
    </NativeSheet>
  );
}

const LocalPhotoRow = memo(function LocalPhotoRow({ photo, index, busy, border, onRemove }: {
  photo: SkyPhoto; index: number; busy: boolean; border: string; onRemove: (id: string) => Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  const remove = useCallback(() => { void onRemove(photo.id); }, [onRemove, photo.id]);
  return (
    <View style={[styles.row, { borderColor: border }]}>
      {photo.uri && !failed ? <Image accessibilityLabel={`Selected photo ${index + 1} of the two of you`} source={{ uri: photo.uri }} style={styles.thumbnail} contentFit="cover" onError={() => setFailed(true)} /> : <ThemedText type="caption" style={styles.missing}>Photo unavailable on this device</ThemedText>}
      <Button label={`Remove photo ${index + 1}`} onPress={remove} disabled={busy} variant="ghost" size="sm" />
    </View>
  );
});

const styles = StyleSheet.create({
  content: { padding: Spacing[24], gap: Spacing[16], paddingBottom: Spacing[32] },
  section: { gap: Spacing[16] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[12], borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing[12] },
  thumbnail: { width: 64, height: 64, borderRadius: Radii.card },
  missing: { flex: 1 },
});
