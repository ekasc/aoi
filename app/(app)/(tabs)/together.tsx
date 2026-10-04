import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocalPhotosSheet } from '@/components/album/local-photos-sheet';
import { SYSTEM_TAB_BAR_IOS_CLEARANCE } from '@/components/home/memory-sky';
import { PhotoSkyViewport } from '@/components/home/photo-sky-viewport';
import { SKY_CONTROL_FILL, SKY_CONTROL_INK } from '@/components/home/sky-palette';
import { SkyHistoryControl } from '@/components/home/sky-history-control';
import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { chooseSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { useSkyPhotos } from '@/features/album/use-sky-photos';
import { skyPreviewStart, usePreviewVariant } from '@/features/dev/preview';
import { haptics } from '@/features/haptics/haptics';
import type { SkyItem } from '@/features/home/day-sky';
import { clampSkyHistoryIndex, formatRelationshipAge, skyHistoryMonths } from '@/features/home/sky-history';
import { useSpace } from '@/features/space/space-context';
import { useSubscription } from '@/features/subscription/subscription-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function UsScreen() {
  const album = useSkyPhotos();
  return <UsPhotoSky album={album} />;
}

export function UsPhotoSky({ album }: { album: ReturnType<typeof useSkyPhotos> }) {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { space } = useSpace();
  const { isPlus } = useSubscription();
  const preview = usePreviewVariant();
  const previewStart = skyPreviewStart(__DEV__ && preview.active ? preview.variant : 'full');
  const plusActive = previewStart.entitlement === null ? isPlus : previewStart.entitlement === 'plus';
  const [now, setNow] = useState(() => new Date());
  const [monthsBack, setMonthsBack] = useState<number | 'start'>(() => previewStart.monthsBack);
  const [historyOpen, setHistoryOpen] = useState(() => previewStart.monthsBack !== 0);
  const [managing, setManaging] = useState(false);
  const [opened, setOpened] = useState<{ scopeKey: string | null; photo: SkyPhoto } | null>(null);
  const lastPhoto = useRef<string | null>(null);
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'textSecondary');
  const startDate = space?.relationshipStartDate ?? null;
  const months = useMemo(() => skyHistoryMonths(startDate, now), [startDate, now]);
  const index = !plusActive ? Math.max(0, months.length - 1) : monthsBack === 'start' ? 0
    : clampSkyHistoryIndex(months.length - 1 - monthsBack, months.length);
  const asOf = months[index]?.asOf ?? now;
  const viewingPast = plusActive && months.length > 0 && index < months.length - 1;
  const photos = useMemo(() => album.photos.filter((photo) => photo.uri !== null && (!viewingPast || Date.parse(photo.addedAt) <= asOf.getTime())), [album.photos, asOf, viewingPast]);
  const skyItems = useMemo<SkyItem[]>(() => photos.map((photo) => ({ id: photo.id, occurredAt: photo.addedAt, authorRole: 'you' })), [photos]);
  const canDiscover = album.status === 'ready' && photos.length > 0 && album.operation === null;
  const busy = album.operation !== null;
  const viewerPhotos = useMemo<ViewerPhoto[]>(() => opened?.photo.uri ? [{ uri: opened.photo.uri, label: 'A photo from your local album' }] : [], [opened]);

  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') setNow(new Date()); });
    return () => subscription.remove();
  }, []);

  const pullPhoto = useCallback((id?: string) => {
    if (!canDiscover) return;
    const photo = id ? photos.find((item) => item.id === id) : chooseSkyPhoto(photos, lastPhoto.current);
    if (!photo) return;
    lastPhoto.current = photo.id;
    haptics.select();
    setOpened({ scopeKey: album.scopeKey, photo });
  }, [album.scopeKey, canDiscover, photos]);
  const closeViewer = useCallback(() => setOpened(null), []);
  const closePhotos = useCallback(() => { if (!busy) setManaging(false); }, [busy]);
  const setSkyIndex = useCallback((next: number) => setMonthsBack(months.length - 1 - next), [months.length]);
  const openPaywall = useCallback(() => router.push({ pathname: '/(app)/paywall', params: { feature: 'sky-history' } }), [router]);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <PhotoSkyViewport key={`${album.scopeKey}:${viewingPast ? asOf.toISOString() : 'today'}`} focused={focused} moments={skyItems} now={asOf} canOpen={canDiscover} onOpenPhoto={pullPhoto}
        height={Math.max(320, height - insets.top - insets.bottom - 80)} />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={[styles.topRow, { paddingTop: insets.top + Spacing[4] }]}>
          <ThemedText type="title" style={styles.skyInk}>Us</ThemedText>
        </View>
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE }]}>
          <View accessibilityLiveRegion="polite" style={styles.discovery}>
            {album.status === 'loading' ? <ThemedText type="caption" style={styles.hint}>Opening your local photos…</ThemedText>
              : album.readError ? <><ThemedText accessibilityRole="alert" type="caption" style={styles.hint}>{album.readError}</ThemedText><Button label="Try again" onPress={album.reload} variant="secondary" /></>
              : canDiscover ? null
              : <><ThemedText type="caption" style={styles.hint}>{viewingPast ? 'No photos in your sky at this date.' : album.photos.length === 0 ? 'No photos in your album yet.' : 'Your album photos are unavailable on this device.'}</ThemedText>
                <Button label={viewingPast ? 'Return to today' : 'Choose photos'} onPress={() => viewingPast ? setMonthsBack(0) : setManaging(true)} variant="secondary" disabled={busy} /></>}
          </View>
          {historyOpen && plusActive ? <View style={styles.history}>
            <SkyHistoryControl months={months} index={index} ageLabel={formatRelationshipAge(startDate, asOf)} isPlus={plusActive}
              onChange={setSkyIndex} onLockedPress={openPaywall} />
            {months.length === 0 ? <Button label="Set our start date" variant="ghost" onPress={() => router.push('/(app)/profile/edit-relationship')} /> : null}
          </View> : null}
          <View style={styles.bottomRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={plusActive ? 'Revisit your sky' : 'Revisit your sky, Plus feature'}
              accessibilityState={plusActive ? { expanded: historyOpen } : undefined}
              onPress={() => plusActive ? setHistoryOpen((open) => !open) : openPaywall()} style={styles.ghostLink}>
              <ThemedText type="caption" style={{ color: muted }}>{historyOpen && plusActive ? 'Hide history' : 'Revisit your sky'}{!plusActive ? ' · Plus' : ''}</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
      <LocalPhotosSheet visible={managing} onClose={closePhotos} album={album} />
      <PhotoViewer visible={opened !== null && opened.scopeKey === album.scopeKey && photos.some((photo) => photo.id === opened.photo.id)}
        photos={viewerPhotos} onClose={closeViewer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing[24] },
  skyInk: { color: SKY_CONTROL_INK },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing[24], gap: Spacing[16] },
  discovery: { alignItems: 'center', gap: Spacing[12] },
  hint: { color: SKY_CONTROL_INK, backgroundColor: SKY_CONTROL_FILL, borderRadius: Radii.card, paddingHorizontal: Spacing[12], paddingVertical: Spacing[8], textAlign: 'center' },
  history: { gap: Spacing[4] },
  bottomRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[8] },
  ghostLink: { minHeight: 44, justifyContent: 'center' },
});
