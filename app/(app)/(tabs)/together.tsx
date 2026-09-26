import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemorySky, SYSTEM_TAB_BAR_IOS_CLEARANCE } from '@/components/home/memory-sky';
import { UsExchange } from '@/components/home/us-exchange';
import { AudioPlayer } from '@/components/media/audio-player';
import { VideoPlayer } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { Pressed } from '@/components/ui/pressed';
import { haptics } from '@/features/haptics/haptics';
import { formatMomentShortDate, formatMomentTime } from '@/features/moments/labels';
import { useMoments } from '@/features/moments/moments-context';
import type { Moment } from '@/features/moments/types';
import { findReadyLetter } from '@/features/home/us-focal';
import { useLetters } from '@/features/letters/letters-context';
import { useResponses } from '@/features/responses/responses-context';
import { useSpace } from '@/features/space/space-context';
import { useSqueeze } from '@/features/squeeze/squeeze-context';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Image } from 'expo-image';
import { Radii, Spacing } from '@/constants/theme';

/** How many days back the sky reaches. */
const REMEMBERED = 40;
/** How long the quiet confirmation stays up before the control resets. */
const SQUEEZE_SENT_VISIBLE_MS = 3000;

/**
 * Us: the sky. You tap it, a day opens.
 *
 * The stars were always the archive, one per day you both had. They were
 * also decoration pinned above a screen about something else, which is why
 * this tab had no job: three tabs covered the archive, the future and the
 * settings, and nothing covered the present.
 *
 * So the sky stops being the wallpaper and becomes the interface. There is
 * no list here, no feed and no queue to drain. You tap, and the archive
 * brings one out, with whatever the two of you have said about it
 * underneath.
 *
 * It is a random memory, not the day under your finger, and that is
 * deliberate. The star field is a calendar camera: it needs a year of
 * history before it means anything. With thirteen memories it is mostly
 * empty, so a tap on a particular star would open nothing and the screen
 * would only work for couples who have been here long enough. Drawing from
 * what actually exists works on the first day and on the thousandth.
 *
 * Stars are 0.35-0.9pt across, which is unmissable as a field and impossible
 * to aim at, so the whole sky is one control rather than a grid of targets.
 *
 * The archive is still reachable as a list, and it has to be: a spatial
 * field of sub-pixel dots is not a thing a screen reader or a hand with a
 * tremor can use, and this screen is not allowed to be the only way in.
 */
export default function UsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { moments, isLoading } = useMoments();
  const { letters } = useLetters();
  const { sendSqueeze, isSending, lastSentAt } = useSqueeze();
  const { space } = useSpace();
  const { loadFor } = useResponses();

  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');

  const [now, setNow] = useState(() => new Date());
  const [opened, setOpened] = useState<Moment | null>(null);
  const [hasTapped, setHasTapped] = useState(false);
  const [ackSentAt, setAckSentAt] = useState<string | null>(null);
  const squeezeSent = Boolean(lastSentAt) && ackSentAt !== lastSentAt;

  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, [])
  );

  useEffect(() => {
    if (!squeezeSent || !lastSentAt) {
      return;
    }
    const timer = setTimeout(() => setAckSentAt(lastSentAt), SQUEEZE_SENT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastSentAt, squeezeSent]);

  const remembered = useMemo(() => {
    const safe = Array.isArray(moments) ? moments : [];
    return safe.slice(0, REMEMBERED);
  }, [moments]);

  /**
   * A tap reaches into the archive and brings one out.
   *
   * Not the day under the finger. The day field is a calendar camera that
   * needs a year of history to mean anything: with thirteen memories it is
   * mostly empty space, so a tap on "that Tuesday" opens nothing, and the
   * screen would only work for couples who have been using the app long
   * enough. Drawing from what actually exists works at three memories or
   * three thousand, which is the only version of this that works on day one.
   *
   * The one guard worth having: never the memory you are already looking at.
   * Tapping twice and getting the same thing twice reads as a broken screen.
   */
  const pullMemory = useCallback(() => {
    if (remembered.length === 0) {
      return;
    }
    const pool =
      remembered.length > 1 ? remembered.filter((moment) => moment.id !== opened?.id) : remembered;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (!next) {
      return;
    }
    haptics.select();
    setHasTapped(true);
    setOpened(next);
  }, [opened?.id, remembered]);

  useEffect(() => {
    loadFor(opened?.id ?? null);
  }, [opened?.id, loadFor]);

  const readyLetter = useMemo(() => {
    const safe = Array.isArray(letters) ? letters : [];
    return findReadyLetter(safe, now);
  }, [letters, now]);

  const handleOpenLetter = useCallback(() => {
    if (readyLetter) {
      router.push({ pathname: '/(app)/letter/[id]', params: { id: readyLetter.id } });
    }
  }, [readyLetter, router]);

  const handleSqueeze = useCallback(() => {
    if (isSending) {
      return;
    }
    void sendSqueeze();
  }, [isSending, sendSqueeze]);

  const handleClose = useCallback(() => {
    setOpened(null);
    loadFor(null);
  }, [loadFor]);

  const skyHeight = Math.max(320, height - insets.top - insets.bottom - 80);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      {/* The sky is the whole screen and the primary surface, so it takes
          touches and stops hiding itself from a screen reader. */}
      <MemorySky
        immersive
        focused={isFocused}
        moments={remembered}
        now={now}
        onPress={pullMemory}
        presentationHeight={skyHeight}
        startDate={space?.relationshipStartDate ?? null}
      />

      <View pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={[styles.topRow, { paddingTop: insets.top + Spacing[4] }]}>
          <ThemedText type="title" style={styles.title}>
            Us
          </ThemedText>
          <View pointerEvents="box-none" style={styles.topActions}>
            {readyLetter ? (
              <Pressable
                accessibilityHint="Opens the letter you wrote to each other"
                accessibilityLabel="A letter is ready to open"
                accessibilityRole="button"
                onPress={handleOpenLetter}
                style={({ pressed }) => [
                  styles.letterPill,
                  { borderColor: border },
                  pressed ? Pressed.at : undefined,
                ]}
              >
                <Ionicons color={muted} name="mail-open-outline" size={16} />
                <ThemedText type="label" style={{ color: muted }}>
                  Ready
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* The one hint this screen has ever needed, and it leaves for good
            after the first tap. Not a scroll cue: there is nothing below. */}
        {!hasTapped && !opened ? (
          <View
            accessibilityLiveRegion="polite"
            pointerEvents="none"
            style={styles.hintWrap}
          >
            <ThemedText type="caption" style={[styles.hint, { color: muted }]}>
              {isLoading
                ? 'Opening your sky…'
                : remembered.length > 0
                  ? 'Tap the sky for something of yours.'
                  : 'Keep a memory and it lights up here.'}
            </ThemedText>
          </View>
        ) : null}

        {/* The way in that does not require hitting a dot. */}
        {!opened ? (
          <View
            pointerEvents="box-none"
            style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE }]}
          >
            <Pressable
              accessibilityHint="Opens the full archive as a list"
              accessibilityLabel="See all memories as a list"
              accessibilityRole="button"
              onPress={() => router.push('/(app)/(tabs)/(memories)')}
              style={({ pressed }) => [styles.ghostLink, pressed ? Pressed.at : undefined]}
            >
              <ThemedText type="caption" style={{ color: muted }}>
                All memories
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityLabel="Squeeze"
              accessibilityRole="button"
              accessibilityState={{ busy: isSending, disabled: isSending }}
              disabled={isSending}
              onPress={handleSqueeze}
              style={({ pressed }) => [pressed ? Pressed.at : undefined]}
            >
              <ThemedText type="label" style={{ color: muted }}>
                {squeezeSent ? 'Sent.' : isSending ? 'Sending…' : 'Squeeze'}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>

      {opened ? (
        <View style={[styles.sheet, { backgroundColor: background, paddingTop: insets.top + Spacing[8] }]}>
          <View style={styles.sheetBar}>
            <ThemedText type="meta" style={{ color: muted }}>
              {formatMomentShortDate(opened.occurredAt)}
            </ThemedText>
            <Pressable
              accessibilityLabel="Close this memory"
              accessibilityRole="button"
              onPress={handleClose}
              style={({ pressed }) => [
                styles.close,
                { borderColor: border },
                pressed ? Pressed.at : undefined,
              ]}
            >
              <Ionicons color={muted} name="close" size={18} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: insets.bottom + Spacing[32] + SYSTEM_TAB_BAR_IOS_CLEARANCE },
            ]}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
          >
            <RememberedMoment
              moment={opened}
              onOpenMemory={() =>
                router.push({
                  pathname: '/(app)/moment/[id]' as const,
                  params: { id: opened.id, at: opened.occurredAt, returnTo: 'us' },
                })
              }
            />
            <UsExchange moment={opened} />
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** The artifact: whatever the memory actually is, at a size worth seeing. */
function RememberedMoment({
  moment,
  onOpenMemory,
}: {
  moment: Moment;
  onOpenMemory: () => void;
}) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  const body = moment.body?.trim() ?? '';
  const title = moment.title?.trim() ?? '';
  const who = moment.authorRole === 'you' ? 'You' : moment.authorName?.trim() || 'They';

  return (
    <View style={styles.remembered}>
      {moment.videoUri ? (
        <VideoPlayer
          aspectRatio={4 / 3}
          label={title || 'Video memory'}
          posterUri={moment.mediaPreview}
          uri={moment.videoUri}
        />
      ) : moment.mediaPreview ? (
        <Pressable
          accessibilityHint="Opens this memory on its own"
          accessibilityLabel={title ? `Open ${title}` : 'Open this memory'}
          accessibilityRole="button"
          onPress={onOpenMemory}
          style={({ pressed }) => [
            styles.frame,
            { borderColor: border },
            pressed ? Pressed.onMedia : undefined,
          ]}
        >
          <Image
            accessible={false}
            contentFit="cover"
            source={{ uri: moment.mediaPreview }}
            style={styles.image}
          />
        </Pressable>
      ) : moment.audioUri ? (
        <View style={[styles.frame, { borderColor: border }]}>
          <AudioPlayer uri={moment.audioUri} />
        </View>
      ) : null}

      <View style={styles.rememberedText}>
        <ThemedText type="meta" style={{ color: muted }}>
          {who} · {formatMomentTime(moment.occurredAt)}
        </ThemedText>
        {title ? <ThemedText type="title">{title}</ThemedText> : null}
        {body ? <ThemedText type="body">{body}</ThemedText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[24],
  },
  title: {
    // Light chrome: the sky behind it is always dark, whatever the theme.
    color: '#FFF8FA',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 8,
  },
  topActions: { flexDirection: 'row' },
  letterPill: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    minHeight: 44,
    paddingHorizontal: Spacing[12],
  },
  hintWrap: {
    alignItems: 'center',
    bottom: 140,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  hint: {
    textAlign: 'center',
  },
  bottomRow: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: Spacing[24],
    position: 'absolute',
    right: 0,
  },
  ghostLink: {
    justifyContent: 'center',
    minHeight: 44,
    paddingRight: Spacing[12],
  },
  sheet: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheetBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[24],
    paddingBottom: Spacing[8],
  },
  close: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sheetContent: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[8],
  },
  remembered: { gap: Spacing[12] },
  frame: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: { aspectRatio: 4 / 3, width: '100%' },
  rememberedText: { gap: Spacing[4] },
});
