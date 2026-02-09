import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MomentCard } from '@/components/moments/moment-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { useMoments } from '@/features/moments/moments-context';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

function ListSpacer() {
  return <View style={styles.listSpacer} />;
}

export default function TimelineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { moments } = useMoments();
  const thread = useThemeColor({}, 'thread');
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const background = useThemeColor({}, 'background');
  const timelineMoments = useMemo(() => [...moments].reverse(), [moments]);

  const periodLabel = useMemo(
    () =>
      new Date().toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  const handleAddMoment = useCallback(() => {
    router.push('/(app)/moment/new');
  }, [router]);

  const handleOpenCalendar = useCallback(() => {
    router.push('/(app)/(tabs)/calendar');
  }, [router]);

  const keyExtractor = useCallback((item: Moment) => item.id, []);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Moment>) => <MomentCard moment={item} />,
    []
  );

  const emptyState = useMemo(
    () => (
      <Surface style={[styles.emptyState, { borderColor: border, backgroundColor: surface }]}>
        <ThemedText type="title" style={styles.emptyTitle}>
          Start your timeline
        </ThemedText>
        <ThemedText type="caption">Add photos, notes, and memories you share.</ThemedText>
      </Surface>
    ),
    [border, surface]
  );
  const railStyle = useMemo(
    () => [styles.rail, { backgroundColor: thread }],
    [thread]
  );
  const rootStyle = useMemo(
    () => [styles.root, { backgroundColor: background, paddingTop: insets.top + Spacing[8] }],
    [background, insets.top]
  );
  const contentContainerStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
    [insets.bottom]
  );

  return (
    <View style={rootStyle}>
      <Animated.View
        entering={FadeInDown.duration(Motion.slow)
          .delay(20)
          .reduceMotion(ReduceMotion.System)}
        style={styles.hero}
      >
        <ThemedText type="meta" selectable>
          Your story
        </ThemedText>
        <ThemedText type="title" selectable>
          Your moments
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          {periodLabel}
        </ThemedText>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(Motion.base)
          .delay(120)
          .reduceMotion(ReduceMotion.System)}
        style={styles.actions}
      >
        <Button label="Add moment" onPress={handleAddMoment} />
        <Button label="Calendar" variant="secondary" onPress={handleOpenCalendar} />
      </Animated.View>

      <View style={styles.timelineWrap}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={railStyle}
        />
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={contentContainerStyle}
          data={timelineMoments}
          ItemSeparatorComponent={ListSpacer}
          keyExtractor={keyExtractor}
          ListEmptyComponent={emptyState}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing[16],
    paddingTop: 0,
    paddingBottom: Spacing[0],
    gap: Spacing[12],
  },
  hero: {
    gap: Spacing[4],
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  timelineWrap: {
    flex: 1,
    position: 'relative',
  },
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: StyleSheet.hairlineWidth,
    transform: [{ translateX: -0.5 }],
    opacity: 0.95,
    zIndex: 0,
  },
  contentContainer: {
    gap: Spacing[8],
    paddingBottom: Spacing[24],
    paddingTop: Spacing[12],
  },
  listSpacer: {
    height: Spacing[8],
  },
  emptyState: {
    marginHorizontal: Spacing[16],
  },
  emptyTitle: {
    marginBottom: Spacing[8],
  },
});
