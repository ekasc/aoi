import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fabBottomOffset } from '@/components/home/compact-sky-geometry';
import { SYSTEM_TAB_BAR_IOS_CLEARANCE } from '@/components/home/memory-sky';
import { PhotoSkyViewport } from '@/components/home/photo-sky-viewport';
import { SKY_CONTROL_FILL, SKY_CONTROL_INK } from '@/components/home/sky-palette';
import { SkyHistoryControl } from '@/components/home/sky-history-control';
import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Pressed } from '@/components/ui/pressed';
import { Elevation, Radii, Spacing, shadow, withAlpha } from '@/constants/theme';
import { chooseSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { useSkyPhotos } from '@/features/album/use-sky-photos';
import { skyPreviewStart, usePreviewVariant } from '@/features/dev/preview';
import { haptics } from '@/features/haptics/haptics';
import type { SkyItem } from '@/features/home/day-sky';
import { clampSkyHistoryIndex, formatRelationshipAge, skyHistoryMonths } from '@/features/home/sky-history';
import { useSpace } from '@/features/space/space-context';
import { useSubscription } from '@/features/subscription/subscription-context';
import { useAoiTheme } from '@/features/theme/theme-context';
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
  // Keep the zoom controls above the docked tab bar and above the
  // history/FAB row, mirroring that row's own bottom clearance.
  const controlsBottom = insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE + 44 + Spacing[16];
  const { space } = useSpace();
  const { isPlus } = useSubscription();
  const preview = usePreviewVariant();
  const previewStart = skyPreviewStart(__DEV__ && preview.active ? preview.variant : 'full');
  const plusActive = previewStart.entitlement === null ? isPlus : previewStart.entitlement === 'plus';
  const [now, setNow] = useState(() => new Date());
  const [monthsBack, setMonthsBack] = useState<number | 'start'>(() => previewStart.monthsBack);
  const [panel, setPanel] = useState<'history' | 'help' | null>(() => previewStart.monthsBack !== 0 ? 'history' : null);
  const historyOpen = panel === 'history' && plusActive;
  const helpOpen = panel === 'help';
  const [opened, setOpened] = useState<{ scopeKey: string | null; photo: SkyPhoto } | null>(null);
  const lastPhoto = useRef<string | null>(null);
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const accent = useThemeColor({}, 'accent');
  const accentInk = useThemeColor({}, 'accentInk');
  const onAccent = useThemeColor({}, 'onAccent');
  const shadowColor = useThemeColor({}, 'shadow');
  const { mode } = useAoiTheme();
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
  const showEmptyPrompt = album.status === 'ready' && photos.length === 0 && !busy && !viewingPast && !helpOpen && !historyOpen;
  const viewerPhotos = useMemo<ViewerPhoto[]>(() => opened?.photo.uri ? [{ uri: opened.photo.uri, label: 'A photo from your local album' }] : [], [opened]);
  const viewerVisible = opened !== null && opened.scopeKey === album.scopeKey && photos.some((photo) => photo.id === opened.photo.id);

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
  const setSkyIndex = useCallback((next: number) => setMonthsBack(months.length - 1 - next), [months.length]);
  const openPaywall = useCallback(() => router.push({ pathname: '/(app)/paywall', params: { feature: 'sky-history' } }), [router]);
  const returnToToday = useCallback(() => { setMonthsBack(0); setPanel(null); }, []);
  const { choosePhotos: importPhotos } = album;
  const choosePhotos = useCallback(() => {
    returnToToday();
    void importPhotos();
  }, [importPhotos, returnToToday]);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <PhotoSkyViewport key={`${album.scopeKey}:${viewingPast ? asOf.toISOString() : 'today'}`} focused={focused && !historyOpen && !helpOpen && !viewerVisible} moments={skyItems} now={asOf} canOpen={canDiscover} onOpenPhoto={pullPhoto}
        height={Math.max(320, height)} controlsBottom={controlsBottom} />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={[styles.topRow, { paddingTop: insets.top + Spacing[8] }]}>
          <ScreenHeader title="Us" tone="onDark" subtitle={viewingPast ? months[index].label : undefined} actions={
            <View style={styles.headerActions}>
              {viewingPast ? <Button label="Today" accessibilityLabel="Return to today" tone="sky" variant="muted" size="sm" onPress={returnToToday} /> : null}
              <IconButton label="About your photo sky" variant="ghost" accessibilityState={{ expanded: helpOpen }} aria-expanded={helpOpen}
                onPress={() => setPanel((current) => current === 'help' ? null : 'help')}>
                <Ionicons name={helpOpen ? 'close' : 'information-circle-outline'} size={24} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
              </IconButton>
            </View>
          } />
        </View>
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE }]}>
          <View accessibilityLiveRegion="polite" style={styles.discovery}>
            {album.status === 'loading' ? <ThemedText type="caption" style={styles.hint}>Loading photos…</ThemedText>
              : album.readError ? <><ThemedText accessibilityRole="alert" type="caption" style={styles.hint}>{album.readError}</ThemedText><Button label="Try again" onPress={album.reload} tone="sky" variant="muted" /></>
              : busy ? <ThemedText type="caption" style={styles.hint}>{album.operation === 'importing' ? 'Adding photos…' : 'Updating photos…'}</ThemedText>
              : canDiscover || showEmptyPrompt || helpOpen ? null
              : <ThemedText type="caption" style={styles.hint}>{viewingPast ? 'No photos at this date.' : album.photos.length === 0 ? 'No photos yet.' : 'Photos unavailable on this device.'}</ThemedText>}
            {album.actionError ? <ThemedText accessibilityRole="alert" type="caption" style={styles.hint}>{album.actionError}</ThemedText> : null}
          </View>
          {showEmptyPrompt || helpOpen || historyOpen ? <ScrollView style={[styles.panel, { backgroundColor: surface, maxHeight: height * 0.45 }]} contentContainerStyle={styles.panelContent}>
            {helpOpen ? <>
              <ThemedText type="subheading">How to explore</ThemedText>
              <ThemedText>Tap the sky to open a photo. Pinch to zoom, then drag to explore.</ThemedText>
              <ThemedText>Double-tap a star to get closer. Double-tap again to see the whole sky.</ThemedText>
              <ThemedText type="caption">Dates show when you added photos, not when they were taken.</ThemedText>
              <ThemedText type="caption">Photos are encrypted on this device. They appear to your partner in your shared sky.</ThemedText>
              <Button label="Manage photos" variant="secondary" onPress={() => router.push('/(app)/album/local-photos')} />
            </> : historyOpen ? <>
              <ThemedText type="subheading">Revisit your sky</ThemedText>
              <ThemedText type="caption">See the photos you had added by each date.</ThemedText>
              <SkyHistoryControl months={months} index={index} ageLabel={formatRelationshipAge(startDate, asOf)} isPlus={plusActive}
                onChange={setSkyIndex} onLockedPress={openPaywall} />
              {months.length === 0 ? <>
                <ThemedText>Add your relationship start date to explore earlier skies.</ThemedText>
                <Button label="Set our start date" variant="secondary" onPress={() => router.push('/(app)/profile/edit-relationship')} />
              </> : null}
            </> : <>
              <ThemedText type="subheading">{album.photos.length === 0 ? 'No photos yet.' : 'Photos unavailable on this device.'}</ThemedText>
              <ThemedText>{album.photos.length === 0 ? 'Choose a few favorites. Each photo becomes a star you can revisit.' : 'Choose the photos again to restore their local copies, or add new favorites.'}</ThemedText>
              <ThemedText type="caption">Photos are encrypted on this device. They appear to your partner in your shared sky.</ThemedText>
              <Button label="Choose photos" accessibilityHint="Opens the photo picker. Photos are encrypted on this device and shared with your partner in your sky." onPress={choosePhotos} />
            </>}
          </ScrollView> : null}
          {album.photos.length > 0 ? <View style={styles.bottomRow}>
            <View style={styles.historyToggle}><IconButton label={plusActive ? 'Revisit your sky' : 'Revisit your sky, Plus feature'} variant="ghost"
              accessibilityState={plusActive ? { expanded: historyOpen } : undefined} aria-expanded={plusActive ? historyOpen : undefined}
              accessibilityHint={plusActive ? 'Shows or hides the date controls' : 'Opens the Plus upgrade for Sky History'}
              onPress={() => plusActive ? setPanel((current) => current === 'history' ? null : 'history') : openPaywall()}>
              <Ionicons name={historyOpen ? 'close' : 'time-outline'} size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
            </IconButton></View>
          </View> : null}
        </View>
      </View>
      {!showEmptyPrompt ? <Pressable accessibilityRole="button" accessibilityLabel="Choose photos"
        accessibilityHint="Opens the photo picker. Photos are encrypted on this device and shared with your partner in your sky."
        accessibilityState={{ disabled: busy || album.status !== 'ready', busy }} disabled={busy || album.status !== 'ready'}
        onPress={choosePhotos} style={({ pressed }) => [styles.fab, { bottom: fabBottomOffset(insets.bottom, process.env.EXPO_OS === 'ios'), boxShadow: shadow(Elevation.floating, shadowColor) }, pressed ? Pressed.onMedia : undefined, busy || album.status !== 'ready' ? styles.fabDisabled : undefined]}>
        <GlassSurface effect="clear" style={[styles.fabGlass, { backgroundColor: withAlpha(accent, process.env.EXPO_OS === 'ios' ? 0.25 : 0.6) }]}>
          <Ionicons name="add" size={26} color={mode === 'dark' ? onAccent : accentInk} accessible={false} aria-hidden />
        </GlassSurface>
      </Pressable> : null}
      <PhotoViewer visible={viewerVisible}
        photos={viewerPhotos} onClose={closeViewer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  topRow: { paddingHorizontal: Spacing[24] },
  skyInk: { color: SKY_CONTROL_INK },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing[24], gap: Spacing[16] },
  discovery: { alignItems: 'center', gap: Spacing[12] },
  hint: { color: SKY_CONTROL_INK, backgroundColor: SKY_CONTROL_FILL, borderRadius: Radii.card, paddingHorizontal: Spacing[12], paddingVertical: Spacing[8], textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing[8] },
  panel: { borderRadius: Radii.card },
  panelContent: { padding: Spacing[16], gap: Spacing[12] },
  historyToggle: { backgroundColor: SKY_CONTROL_FILL, borderRadius: Radii.pill },
  bottomRow: { alignItems: 'flex-start' },
  fab: { position: 'absolute', right: Spacing[24], width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  fabGlass: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  fabDisabled: { opacity: 0.55 },
});
