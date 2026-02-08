import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

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
  const { moments } = useMoments();
  const thread = useThemeColor({}, 'thread');

  const handleAddMoment = useCallback(() => {
    router.push('/(app)/moment/new');
  }, [router]);

  const handleOpenRecaps = useCallback(() => {
    router.push('/(app)/(tabs)/recaps');
  }, [router]);

  const keyExtractor = useCallback((item: Moment) => item.id, []);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Moment>) => <MomentCard moment={item} />,
    []
  );

  const emptyState = useMemo(
    () => (
      <Surface style={styles.emptyState}>
        <ThemedText type="title" style={styles.emptyTitle}>
          No moments yet
        </ThemedText>
        <ThemedText type="body">
          Add the first moment and start this timeline for both of you.
        </ThemedText>
      </Surface>
    ),
    []
  );
  const railStyle = useMemo(
    () => [styles.rail, { backgroundColor: thread }],
    [thread]
  );

  return (
    <View style={styles.root}>
      <Animated.View
        entering={FadeInDown.duration(Motion.slow)
          .delay(20)
          .reduceMotion(ReduceMotion.System)}
        style={styles.hero}
      >
        <ThemedText type="meta">Shared timeline</ThemedText>
        <ThemedText type="title">Current moments first</ThemedText>
        <ThemedText type="caption">
          Scroll up to move deeper into older notes, milestones, and media.
        </ThemedText>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(Motion.base)
          .delay(120)
          .reduceMotion(ReduceMotion.System)}
        style={styles.actions}
      >
        <Button label="Add moment" onPress={handleAddMoment} />
        <Button label="Open recaps" variant="secondary" onPress={handleOpenRecaps} />
      </Animated.View>

      <View style={styles.timelineWrap}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={railStyle}
        />
        <FlatList
          inverted
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.contentContainer}
          data={moments}
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
    paddingTop: Spacing[16],
    paddingBottom: Spacing[12],
    gap: Spacing[12],
  },
  hero: {
    gap: Spacing[8],
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
    opacity: 0.8,
    zIndex: 0,
  },
  contentContainer: {
    gap: Spacing[8],
    paddingBottom: Spacing[8],
    paddingTop: Spacing[8],
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
