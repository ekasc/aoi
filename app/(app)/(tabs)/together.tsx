import { Image } from 'expo-image';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemorySky, SYSTEM_TAB_BAR_IOS_CLEARANCE } from '@/components/home/memory-sky';
import { SKY_CONTROL_INK } from '@/components/home/sky-palette';
import { MomentCard } from '@/components/moments/moment-card';
import { PendingMemoryRow } from '@/components/moments/pending-memory-row';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pressed } from '@/components/ui/pressed';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/features/calendar/calendar-context';
import { constellationPoints, nextTogetherPlan, usHistory } from '@/features/home/us-history';
import { findReadyLetter } from '@/features/home/us-focal';
import { useLetters } from '@/features/letters/letters-context';
import { galleryPhotosOf } from '@/features/moments/gallery';
import { formatResurfaceLabel } from '@/features/moments/resurface';
import type { Moment } from '@/features/moments/types';
import { useStoryFeed } from '@/features/moments/use-story-feed';
import { useSpace } from '@/features/space/space-context';
import { useSqueeze } from '@/features/squeeze/squeeze-context';
import { formatDaysTogether } from '@/features/time-together/time-together';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function UsScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const feed = useStoryFeed();
  const calendar = useCalendar();
  const letterState = useLetters();
  const { space } = useSpace();
  const { sendSqueeze, isSending, lastSentAt } = useSqueeze();
  const [now, setNow] = useState(() => new Date());
  const [ackSentAt, setAckSentAt] = useState<string | null>(null);
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'textSecondary');
  const accent = useThemeColor({}, 'accentInk');
  const border = useThemeColor({}, 'border');
  const history = useMemo(() => usHistory(feed.moments, space?.relationshipStartDate ?? null, now), [feed.moments, space?.relationshipStartDate, now]);
  const readyLetter = useMemo(() => findReadyLetter(letterState.letters, now), [letterState.letters, now]);
  const plan = useMemo(() => nextTogetherPlan(calendar.upcomingEvents, now), [calendar.upcomingEvents, now]);
  const sent = Boolean(lastSentAt) && ackSentAt !== lastSentAt;
  const recent = history.recent;
  const resurface = history.resurface;
  const resurfacePhoto = useMemo(() => resurface ? galleryPhotosOf(resurface.moment)[0] ?? null : null, [resurface]);

  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') setNow(new Date()); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!sent || !lastSentAt) return;
    const timer = setTimeout(() => setAckSentAt(lastSentAt), 3000);
    return () => clearTimeout(timer);
  }, [lastSentAt, sent]);

  const openMemory = useCallback((id: string) => {
    const moment = history.story.find((item) => item.id === id);
    if (moment) router.push({ pathname: '/(app)/moment/[id]', params: { id, at: moment.occurredAt } });
  }, [history.story, router]);
  const renderMemory = useCallback(({ item }: ListRenderItemInfo<Moment>) => (
    <View>
      <MomentCard moment={item} presentation="timeline" />
      <View style={styles.memoryLink}><Button label="Open memory" accessibilityLabel={`Open memory from ${item.authorName}, ${item.title || new Date(item.occurredAt).toLocaleDateString('en-US')}`}
        variant="ghost" onPress={() => openMemory(item.id)} /></View>
    </View>
  ), [openMemory]);

  const header = (
    <View>
      <View style={styles.sky}>
        <MemorySky immersive focused={focused} moments={history.moments} daysTogether={history.daysTogether}
          now={now} presentationHeight={360} startDate={space?.relationshipStartDate ?? null} />
        <View pointerEvents="box-none" style={[styles.skyWords, { paddingTop: insets.top + Spacing[24] }]}>
          <ThemedText type="title" style={styles.skyInk}>Us</ThemedText>
          <View style={styles.skyCaption}>
            <ThemedText type="display">Our sky</ThemedText>
            {history.daysTogether !== null ? <ThemedText type="body">{formatDaysTogether(history.daysTogether)}</ThemedText> :
              <Button label="Set our start date" variant="secondary" onPress={() => router.push('/(app)/profile/edit-relationship')} />}
          </View>
        </View>
      </View>
      <View style={styles.editorial}>
        <View style={styles.links}>
          <Button label="Keep a memory" variant="ghost" onPress={() => router.push('/(app)/moment/new')} />
          <Button label={sent ? 'Sent.' : isSending ? 'Sending…' : 'Squeeze'} variant="ghost"
            accessibilityLabel="Squeeze" accessibilityHint="Sends your partner a thinking-of-you signal"
            accessibilityState={{ busy: isSending, disabled: isSending }} disabled={isSending}
            onPress={() => { if (!isSending) void sendSqueeze(); }} />
        </View>
        {readyLetter || plan || history.recent ? (
          <View style={styles.section}>
            <ThemedText type="subheading">Here with you</ThemedText>
            {readyLetter ? <Button label="A letter is ready to open" variant="secondary"
              onPress={() => router.push({ pathname: '/(app)/letter/[id]', params: { id: readyLetter.id } })} /> : null}
            {plan ? <Pressable accessibilityRole="button" accessibilityLabel={`Open together plan: ${plan.title}`}
              onPress={() => { calendar.setSelectedDate(new Date(plan.startsAt)); router.push('/(app)/(tabs)/plans'); }} style={styles.entry}>
              <ThemedText type="caption" style={{ color: muted }}>{new Date(plan.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</ThemedText>
              <ThemedText type="bodyEmphasis">{plan.title}</ThemedText>
            </Pressable> : null}
            {history.recent ? <Pressable accessibilityRole="button" accessibilityLabel={`Open recent memory from ${history.recent.authorName}`}
              onPress={() => { if (recent) openMemory(recent.id); }} style={styles.entry}>
              <ThemedText type="caption" style={{ color: muted }}>{history.recent.authorName} kept a memory</ThemedText>
              <ThemedText type="body">{history.recent.title || history.recent.body || 'A shared memory'}</ThemedText>
            </Pressable> : null}
          </View>
        ) : null}
        {calendar.error || letterState.error ? <View accessibilityLiveRegion="polite" style={styles.section}>
          <ThemedText accessibilityRole="alert" type="caption">Some shared activity could not load.</ThemedText>
          {calendar.error ? <Button label="Retry plans" variant="ghost" onPress={() => { void calendar.refresh(); }} /> : null}
          {letterState.error ? <Button label="Retry letters" variant="ghost" onPress={() => { void letterState.reload(); }} /> : null}
        </View> : null}
        {history.resurface ? <View style={styles.section}>
          <ThemedText type="subheading">On this night</ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>{formatResurfaceLabel(history.resurface.yearsAgo)}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel="Open this memory" accessibilityHint="Opens the full memory and its media"
            onPress={() => { if (resurface) openMemory(resurface.moment.id); }} style={styles.resurface}>
            {resurfacePhoto ? <Image accessible={false} source={{ uri: resurfacePhoto.uri }} contentFit="cover" style={styles.resurfacePhoto} /> : null}
            <View style={styles.resurfaceText}>
              <ThemedText type="body">{history.resurface.moment.title || history.resurface.moment.body || 'A memory we kept'}</ThemedText>
              <ThemedText type="caption" style={{ color: accent }}>Open memory</ThemedText>
            </View>
          </Pressable>
        </View> : null}
        {history.chapters.length > 0 ? <View style={styles.section}>
          <ThemedText type="subheading">Our constellations</ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>Years of memories kept together</ThemedText>
          {history.chapters.map((chapter) => {
            const points = constellationPoints(chapter.memoryIds);
            return <Pressable key={chapter.id} accessibilityRole="button" accessibilityLabel={`Open ${chapter.title} chapter`}
              onPress={() => router.push({ pathname: '/(app)/chapter/[id]', params: { id: chapter.id } })}
              style={({ pressed }) => [styles.chapter, { borderColor: border }, pressed ? Pressed.at : undefined]}>
              <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.constellation}>
                {points.map((point, index) => {
                  const previous = points[index - 1];
                  const length = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
                  return <View key={index}>
                    {previous ? <View style={[styles.line, { backgroundColor: accent, width: length,
                      left: (point.x + previous.x - length) / 2, top: (point.y + previous.y) / 2,
                      transform: [{ rotate: `${Math.atan2(point.y - previous.y, point.x - previous.x)}rad` }] }]} /> : null}
                    <View style={[styles.point, { backgroundColor: accent, left: point.x - 2.5, top: point.y - 2.5 }]} />
                  </View>;
                })}
              </View>
              <ThemedText type="bodyEmphasis" style={styles.chapterTitle}>{chapter.title}</ThemedText>
            </Pressable>;
          })}
        </View> : null}
        <View style={styles.links}>
          <Button label="Letters" variant="ghost" onPress={() => router.push('/(app)/letters')} />
          <Button label="Little things" variant="ghost" onPress={() => router.push('/(app)/profile/little-things')} />
        </View>
        <View style={styles.section}>
          <ThemedText type="subheading">Our story</ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>What we chose to share, in the order it happened.</ThemedText>
          <Button label="Open Memories" variant="ghost" onPress={() => router.push('/(app)/(tabs)/(memories)')} />
          {feed.pending.map((record) => <PendingMemoryRow key={record.clientId} record={record} isSending={feed.sendingIds.includes(record.clientId)} />)}
          {feed.isLoading ? <ThemedText accessibilityLiveRegion="polite">Opening your shared memories…</ThemedText> :
            feed.error ? <View accessibilityLiveRegion="polite"><ThemedText accessibilityRole="alert">Could not load your story.</ThemedText><Button label="Retry memories" onPress={feed.refresh} /></View> :
              history.story.length === 0 && feed.pending.length === 0 ? <View style={styles.section}>
                <ThemedText type="body">No shared memories yet.</ThemedText>
                <ThemedText type="caption" style={{ color: muted }}>Keep a note, photo or voice memory for the two of you.</ThemedText>
                <Button label="Keep our first memory" onPress={() => router.push('/(app)/moment/new')} />
              </View> : null}
          {feed.hasMore ? <Button label={feed.isPaging ? 'Loading earlier…' : feed.pagingError ? 'Retry earlier memories' : 'Load earlier memories'}
            disabled={feed.isPaging} accessibilityState={{ busy: feed.isPaging, disabled: feed.isPaging }} variant="ghost" onPress={feed.loadMore} /> : null}
        </View>
      </View>
    </View>
  );

  return <View style={[styles.root, { backgroundColor: background }]}>
    <FlatList data={history.story} keyExtractor={(moment) => moment.id} renderItem={renderMemory} ListHeaderComponent={header}
      contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: insets.bottom + Spacing[24] + SYSTEM_TAB_BAR_IOS_CLEARANCE }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, maxWidth: 720, width: '100%', alignSelf: 'center' },
  sky: { height: 360, overflow: 'hidden' },
  skyWords: { ...StyleSheet.absoluteFill, paddingHorizontal: Spacing[24], justifyContent: 'space-between', paddingBottom: Spacing[32] },
  skyInk: { color: SKY_CONTROL_INK },
  skyCaption: { gap: Spacing[8] },
  editorial: { paddingHorizontal: Spacing[24], paddingTop: Spacing[16], gap: Spacing[32] },
  section: { gap: Spacing[12] },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing[8] },
  entry: { minHeight: 44, gap: Spacing[4], paddingVertical: Spacing[8] },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: Spacing[16], paddingVertical: Spacing[12], borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  chapterTitle: { flex: 1 },
  resurface: { flexDirection: 'row', alignItems: 'center', gap: Spacing[16], minHeight: 44 },
  resurfacePhoto: { width: 88, height: 88, borderRadius: 12 },
  resurfaceText: { flex: 1, gap: Spacing[8] },
  memoryLink: { alignItems: 'flex-start', paddingHorizontal: Spacing[24], paddingBottom: Spacing[16] },
  constellation: { width: 100, height: 50 },
  point: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5 },
  line: { position: 'absolute', height: 1 },
});
