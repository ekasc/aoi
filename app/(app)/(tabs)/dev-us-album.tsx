import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pressed } from '@/components/ui/pressed';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

const STORAGE_KEY = 'aoi.dev.us-album.v1';

type Picked = {
  /**
   * The library identifier, when the picker gave one.
   *
   * It is nullable, and the reason is the probe's most useful finding: PHPicker
   * hands back an id only when the user granted real library access. When they
   * pick under limited permission, or browse by file on Android, it is null
   * and there is nothing to compare a later pick against. Which means an "us
   * album" built this way is a snapshot you maintain, not a live binding to a
   * collection, and you cannot detect new arrivals from picker data alone.
   */
  assetId: string | null;
  uri: string;
  width: number;
  height: number;
};

/**
 * THROWAWAY. Not a screen, a probe.
 *
 * The question this answers is narrow: if a couple points the system picker
 * at the photos of the two of them, what actually comes back, and does
 * anything about it move on its own afterwards?
 *
 * What it can honestly answer, in Expo Go:
 *   - whether the system picker lets you select a whole album in one go
 *   - exactly what an asset carries back (id, uri, dimensions, date)
 *   - whether a later pick overlaps the earlier one, which is the observable
 *     part of "does it update"
 *
 * What it cannot answer here, and the screen says so rather than implying:
 *   - spotting NEW photos on its own. That needs expo-media-library, which is
 *     a native module, which needs a dev build.
 *   - grouping the photos into people. That needs expo-face-detector, same
 *     story, and it is a bigger question than this probe is.
 */
export default function DevUsAlbumScreen() {
  const insets = useSafeAreaInsets();
  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  const accent = useThemeColor({}, 'accent');

  const [picked, setPicked] = useState<Picked[]>([]);
  const [lastPick, setLastPick] = useState<{ added: number; repeated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setPicked([]);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setPicked(parsed as Picked[]);
      }
    } catch {
      setPicked([]);
    }
  }, []);

  // Re-read on focus so a pick made and abandoned is visible on the way back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const pick = useCallback(async () => {
    setBusy(true);
    setNote('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        // No limit: the point of the probe is to see whether an entire album
        // comes back in one gesture.
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) {
        setNote('Cancelled.');
        return;
      }
      const next: Picked[] = result.assets.map((asset) => ({
        assetId: asset.assetId ?? null,
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      }));
      const previousIds = new Set(picked.map((p) => p.assetId).filter(Boolean));
      const repeated = next.filter((p) => p.assetId && previousIds.has(p.assetId)).length;
      setLastPick({ added: next.length - repeated, repeated });
      setPicked(next);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNote(
        `Picked ${next.length}. ${next.length - repeated} new to this device, ${repeated} already in the set.`
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'The picker failed.');
    } finally {
      setBusy(false);
    }
  }, [picked]);

  const clear = useCallback(async () => {
    setPicked([]);
    setLastPick(null);
    setNote('');
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing[16], paddingBottom: insets.bottom + Spacing[32] },
      ]}
      contentInsetAdjustmentBehavior="never"
      style={{ backgroundColor: background }}
    >
      <Stack.Screen options={{ title: 'Us album probe' }} />

      <ThemedText type="title">Us album probe</ThemedText>
      <ThemedText type="body" style={{ color: muted }}>
        Throwaway. Pick the photos of the two of you and watch what comes back.
      </ThemedText>

      <View style={[styles.limits, { borderColor: border }]}>
        <Text style={[styles.limitsTitle, { color: accent }]}>What this cannot do in Expo Go</Text>
        <Text style={[styles.limitsBody, { color: muted }]}>
          Spot new photos by itself. That needs expo-media-library.
          {'\n'}Group them into people. That needs expo-face-detector.
          {'\n\n'}Both are native modules, so both need a dev build. Everything
          below works today.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          disabled={busy}
          label={busy ? 'Opening…' : 'Pick photos of us'}
          onPress={pick}
        />
        {picked.length > 0 ? (
          <Button label="Clear" onPress={clear} variant="ghost" />
        ) : null}
      </View>

      {note ? (
        <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
          {note}
        </ThemedText>
      ) : null}

      {lastPick ? (
        <View style={[styles.stats, { borderColor: border }]}>
          <Stat label="In the set" value={String(picked.length)} />
          <Stat label="New last pick" value={String(lastPick.added)} />
          <Stat label="Already in it" value={String(lastPick.repeated)} />
        </View>
      ) : null}

      {picked.length === 0 ? (
        <ThemedText type="caption" style={{ color: muted }}>
          Nothing picked yet.
        </ThemedText>
      ) : (
        <View style={styles.grid}>
          {picked.map((photo, index) => (
            <View key={`${photo.assetId ?? 'x'}-${index}`} style={[styles.tile, { borderColor: border }]}>
              <Image accessible={false} contentFit="cover" source={{ uri: photo.uri }} style={styles.tileImage} />
              <Text numberOfLines={1} style={[styles.tileId, { color: muted }]}>
                {photo.assetId ? photo.assetId.slice(-8) : 'no id'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {picked.length > 0 ? (
        <ThemedText type="caption" style={{ color: muted }}>
          The eight characters under each photo are the tail of the library
          identifier, and where it says &ldquo;no id&rdquo; the picker gave none. That
          column is the whole question: with ids you can tell a repeat pick
          from a new one, and without them you cannot tell anything.
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => setNote('')}
        style={({ pressed }) => [styles.dismiss, pressed ? Pressed.at : undefined]}
      >
        <ThemedText type="caption" style={{ color: muted }}>
          Dismiss message
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const muted = useThemeColor({}, 'textSecondary');
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: value === '0' ? muted : undefined }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[16],
  },
  limits: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing[8],
    padding: Spacing[12],
  },
  limitsTitle: { fontSize: 13, fontWeight: '600' },
  limitsBody: { fontSize: 13, lineHeight: 19 },
  actions: { gap: Spacing[8] },
  stats: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    padding: Spacing[12],
  },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 22, fontWeight: '600' },
  statLabel: { fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[8] },
  tile: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', width: '31%' },
  tileImage: { aspectRatio: 1, width: '100%' },
  tileId: { fontSize: 9, paddingHorizontal: 3, paddingVertical: 2 },
  dismiss: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
