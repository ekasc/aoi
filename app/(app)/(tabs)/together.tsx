import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocalPhotosSheet } from '@/components/album/local-photos-sheet';
import { AutomaticAlbumSheet } from '@/components/album/automatic-album-sheet';
import { MemorySky, SYSTEM_TAB_BAR_IOS_CLEARANCE } from '@/components/home/memory-sky';
import { SKY_CONTROL_FILL, SKY_CONTROL_INK } from '@/components/home/sky-palette';
import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';
import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pressed } from '@/components/ui/pressed';
import { Radii, Spacing } from '@/constants/theme';
import { chooseSkyPhoto, type SkyPhoto } from '@/features/album/sky-photo-repository';
import { useSkyPhotos } from '@/features/album/use-sky-photos';
import { useAutomaticAlbum } from '@/features/album/automatic-album-state';
import { haptics } from '@/features/haptics/haptics';
import { findReadyLetter } from '@/features/home/us-focal';
import type { SkyItem } from '@/features/home/day-sky';
import { useLetters } from '@/features/letters/letters-context';
import { useSpace } from '@/features/space/space-context';
import { useSqueeze } from '@/features/squeeze/squeeze-context';
import { useThemeColor } from '@/hooks/use-theme-color';

const SQUEEZE_SENT_VISIBLE_MS = 3000;

export default function UsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const album = useSkyPhotos();
  const automatic = useAutomaticAlbum();
  const { letters } = useLetters();
  const { sendSqueeze, isSending, lastSentAt } = useSqueeze();
  const { space } = useSpace();
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'textSecondary');
  const star = useRef<View>(null);
  const lastPhoto = useRef<string | null>(null);
  const seenAutomaticRevision = useRef<{ scopeKey: string | null; revision: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [opened, setOpened] = useState<{ scopeKey: string | null; photo: SkyPhoto; origin?: PhotoOrigin } | null>(null);
  const [managing, setManaging] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [ackSentAt, setAckSentAt] = useState<string | null>(null);
  const squeezeSent = Boolean(lastSentAt) && ackSentAt !== lastSentAt;
  const canDiscover = album.status === 'ready' && album.photos.some((photo) => photo.uri !== null) && album.operation === null;
  const busy = album.operation !== null;
  const skyHeight = Math.max(320, height - insets.top - insets.bottom - 80);
  const skyItems = useMemo<SkyItem[]>(() => album.photos.filter((photo) => photo.uri !== null).map((photo) => ({ id: photo.id, occurredAt: photo.addedAt, authorRole: 'you' })), [album.photos]);

  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  const automaticRevision = automatic?.revision;
  const reloadPhotos = album.reload;
  useEffect(() => {
    if (!automaticRevision || album.operation !== null || album.status === 'loading') return;
    if (seenAutomaticRevision.current?.scopeKey === album.scopeKey && seenAutomaticRevision.current.revision === automaticRevision) return;
    seenAutomaticRevision.current = { scopeKey: album.scopeKey, revision: automaticRevision };
    reloadPhotos();
  }, [automaticRevision, reloadPhotos, album.operation, album.status, album.scopeKey]);
  useEffect(() => {
    if (!squeezeSent || !lastSentAt) return;
    const timer = setTimeout(() => setAckSentAt(lastSentAt), SQUEEZE_SENT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastSentAt, squeezeSent]);

  const pullPhoto = useCallback(() => {
    if (!canDiscover) return;
    const photo = chooseSkyPhoto(album.photos, lastPhoto.current);
    if (!photo) return;
    lastPhoto.current = photo.id;
    haptics.select();
    if (star.current) {
      star.current.measureInWindow((x, y, width, measuredHeight) => {
        setOpened({ scopeKey: album.scopeKey, photo, origin: { x: x + width / 2 - 2, y: y + measuredHeight / 2 - 2, width: 4, height: 4, radius: 2 } });
      });
    } else {
      setOpened({ scopeKey: album.scopeKey, photo });
    }
  }, [album.photos, album.scopeKey, canDiscover]);
  const closeViewer = useCallback(() => setOpened(null), []);
  const closePhotos = useCallback(() => { if (!busy) setManaging(false); }, [busy]);
  const readyLetter = useMemo(() => findReadyLetter(Array.isArray(letters) ? letters : [], now), [letters, now]);
  const viewerPhotos = useMemo<ViewerPhoto[]>(() => opened?.photo.uri ? [{ uri: opened.photo.uri, label: 'A photo from your local album' }] : [], [opened]);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Bring out a photo of the two of you" accessibilityHint="Opens one photo from your local album"
        accessibilityState={{ disabled: !canDiscover }} disabled={!canDiscover} onPress={pullPhoto} style={StyleSheet.absoluteFill}>
        <MemorySky immersive focused={isFocused} moments={skyItems} now={now} presentationHeight={skyHeight} startDate={space?.relationshipStartDate ?? null} />
      </Pressable>
      <View pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={[styles.topRow, { paddingTop: insets.top + Spacing[4] }]}>
          <ThemedText type="title" style={styles.title}>Us</ThemedText>
          {readyLetter ? (
            <Pressable accessibilityHint="Opens your ready letter" accessibilityLabel="A letter is ready to open" accessibilityRole="button"
              onPress={() => router.push({ pathname: '/(app)/letter/[id]', params: { id: readyLetter.id } })}
              style={({ pressed }) => [styles.letterPill, pressed ? Pressed.at : undefined]}>
              <Ionicons color={SKY_CONTROL_INK} name="mail-open-outline" size={16} />
              <ThemedText type="label" style={styles.title}>Ready</ThemedText>
            </Pressable>
          ) : null}
        </View>
        <View ref={star} collapsable={false} pointerEvents="none" accessible={false} style={styles.star}>
          {canDiscover ? <ThemedText accessible={false} style={styles.starGlyph}>✦</ThemedText> : null}
        </View>
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE }]}>
          <View accessibilityLiveRegion="polite" style={styles.discovery}>
            {album.status === 'loading' ? <ThemedText type="caption" style={styles.hint}>Opening your local photos…</ThemedText>
              : album.readError ? <><ThemedText accessibilityRole="alert" type="caption" style={styles.hint}>{album.readError}</ThemedText><Button label="Try again" onPress={album.reload} variant="secondary" /></>
              : canDiscover ? <><ThemedText type="caption" style={styles.hint}>Tap the sky for a photo of the two of you.</ThemedText><Button label="Bring out a photo" onPress={pullPhoto} variant="secondary" /></>
              : <><ThemedText type="caption" style={styles.hint}>{album.photos.length === 0 ? (automatic?.status === 'scanning' ? 'Finding photos with both of you…' : 'No photos in your album yet.') : 'Your album photos are unavailable on this device.'}</ThemedText><Button label={automatic ? (automatic.enabled ? 'Automatic discovery' : 'Find photos of us') : 'Choose photos'} onPress={() => automatic ? setSettingUp(true) : setManaging(true)} variant="secondary" disabled={busy} /></>}
          </View>
          <View style={styles.bottomRow}>
            {automatic ? <Pressable accessibilityLabel="Automatic album discovery" accessibilityRole="button" onPress={() => setSettingUp(true)} style={styles.ghostLink}>
              <ThemedText type="caption" style={{ color: muted }}>{automatic?.enabled ? 'Discovery on' : 'Find photos of us'}</ThemedText>
            </Pressable> : null}
            <Pressable accessibilityLabel="Manage photos for your sky" accessibilityRole="button" onPress={() => setManaging(true)} style={styles.ghostLink}>
              <ThemedText type="caption" style={{ color: muted }}>Photos on this device</ThemedText>
            </Pressable>
            <Pressable accessibilityLabel="Squeeze" accessibilityRole="button" accessibilityHint="Sends your partner a thinking-of-you signal"
              accessibilityState={{ busy: isSending, disabled: isSending }} disabled={isSending}
              onPress={() => { if (!isSending) void sendSqueeze(); }} style={styles.ghostLink}>
              <ThemedText type="label" style={{ color: muted }}>{squeezeSent ? 'Sent.' : isSending ? 'Sending…' : 'Squeeze'}</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
      <LocalPhotosSheet visible={managing} onClose={closePhotos} album={album} />
      <AutomaticAlbumSheet visible={settingUp} onClose={() => setSettingUp(false)} />
      <PhotoViewer visible={opened !== null && opened.scopeKey === album.scopeKey} photos={viewerPhotos} origin={opened?.origin} onClose={closeViewer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing[24] },
  title: { color: SKY_CONTROL_INK },
  letterPill: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: SKY_CONTROL_INK, backgroundColor: SKY_CONTROL_FILL, flexDirection: 'row', gap: Spacing[8], minHeight: 44, paddingHorizontal: Spacing[12] },
  star: { position: 'absolute', top: '40%', left: '45%', width: '10%', alignItems: 'center', justifyContent: 'center' },
  starGlyph: { color: SKY_CONTROL_INK, fontSize: 28, lineHeight: 36 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing[24], gap: Spacing[16] },
  discovery: { alignItems: 'center', gap: Spacing[12] },
  hint: { color: SKY_CONTROL_INK, backgroundColor: SKY_CONTROL_FILL, borderRadius: Radii.card, paddingHorizontal: Spacing[12], paddingVertical: Spacing[8], textAlign: 'center' },
  bottomRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[8] },
  ghostLink: { minHeight: 44, justifyContent: 'center' },
});
