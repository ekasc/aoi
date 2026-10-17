import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';

import { YearMonthRow, yearSectionHeight, yearMiniWidth, yearRowCount, yearRowLayout, type YearPlans } from '@/components/calendar/year-section';
import { useCalendar } from '@/features/calendar/calendar-context';
import { toDayKey } from '@/features/calendar/calendar-date-utils';
import { getEventOwnership, type EventOwnershipTone } from '@/features/calendar/event-ownership';
import { useThemeColor } from '@/hooks/use-theme-color';
import { beginPhase, readPhases, resetPhases } from '@/features/dev/phase-timer';

const RADIUS = 2;
const TONE_RANK: Record<EventOwnershipTone, number> = { you: 0, partner: 1, together: 2 };
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1 };
type YearRow = { year: number; row: number };

type YearPagerProps = {
  initialYear: number;
  width: number;
  now: Date;
  selectedDate: Date;
  onOpen: (month: Date) => void;
  onVisibleYearChange?: (year: number) => void;
  bottomClearance?: number;
};

export function YearPager({ initialYear, width, now, selectedDate, onOpen, onVisibleYearChange, bottomClearance = 0 }: YearPagerProps) {
  const endBody = beginPhase('year:pager-body');
  const { fontScale } = useWindowDimensions();
  const { eventsInRange } = useCalendar();
  const ownColor = useThemeColor({}, 'accent');
  const partnerColor = useThemeColor({}, 'partnerAccent');
  const sectionHeight = yearSectionHeight(fontScale);
  const rowsPerYear = yearRowCount(fontScale);
  const [anchor, setAnchor] = useState(initialYear);
  const [plans, setPlans] = useState<Record<number, YearPlans>>({});
  const requested = useRef(new Set<number>());
  const generation = useRef(0);
  const scroller = useRef<FlatList<YearRow>>(null);
  const fraction = useRef(0);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useMemo(() => Array.from({ length: (RADIUS * 2 + 1) * rowsPerYear }, (_, index) => ({
    year: anchor + Math.floor(index / rowsPerYear) - RADIUS,
    row: index % rowsPerYear,
  })), [anchor, rowsPerYear]);

  const loadYear = useCallback((year: number) => {
    if (requested.current.has(year)) return;
    requested.current.add(year);
    const requestGeneration = generation.current;
    // Span the read so its cost can be separated from the grid's render cost.
    const endRead = beginPhase('year:density-read');
    void eventsInRange(new Date(year, 0, 1), new Date(year + 1, 0, 1)).then((events) => {
      endRead();
      if (requestGeneration !== generation.current) return;
      const tones = new Map<string, EventOwnershipTone>();
      for (const event of events) {
        const key = toDayKey(new Date(event.startsAt));
        const tone = getEventOwnership(event, { ownColor, partnerColor }).tone;
        const previous = tones.get(key);
        if (previous === undefined || TONE_RANK[tone] > TONE_RANK[previous]) tones.set(key, tone);
      }
      setPlans((current) => ({ ...current, [year]: { tones, failed: false } }));
    }, () => {
      endRead();
      if (requestGeneration === generation.current) {
        setPlans((current) => ({ ...current, [year]: { tones: null, failed: true } }));
      }
    });
  }, [eventsInRange, ownColor, partnerColor]);

  useEffect(() => () => {
    generation.current += 1;
    requested.current.clear();
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
  }, []);
  useEffect(() => { loadYear(initialYear); }, [initialYear, loadYear]);

  const land = useCallback(() => {
    scroller.current?.scrollToOffset({ offset: (RADIUS + fraction.current) * sectionHeight, animated: false });
  }, [sectionHeight]);
  useEffect(land, [anchor, land]);

  const settleOffset = useCallback((offset: number) => {
    const page = offset / sectionHeight;
    const index = Math.max(0, Math.min(RADIUS * 2, Math.round(page)));
    const year = anchor + index - RADIUS;
    onVisibleYearChange?.(year);
    loadYear(year);
    if (index === 0 || index === RADIUS * 2) {
      fraction.current = page - index;
      setAnchor(year);
    }
  }, [anchor, loadYear, onVisibleYearChange, sectionHeight]);
  const settle = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    settleOffset(event.nativeEvent.contentOffset.y);
  }, [settleOffset]);
  const reportYear = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const index = Math.max(0, Math.min(RADIUS * 2, Math.round(offset / sectionHeight)));
    onVisibleYearChange?.(anchor + index - RADIUS);
    if (process.env.EXPO_OS === 'web') {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
      scrollEndTimer.current = setTimeout(() => settleOffset(offset), 160);
    }
  }, [anchor, onVisibleYearChange, sectionHeight, settleOffset]);
  const visibleRowsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<YearRow>[] }) => {
    for (const token of viewableItems) if (token.isViewable) loadYear(token.item.year);
  }, [loadYear]);
  const renderRow = useCallback(({ item }: { item: YearRow }) => (
    <YearMonthRow {...item} width={yearMiniWidth(width, fontScale)} now={now} selectedDate={selectedDate} onOpen={onOpen} plans={plans[item.year]} />
  ), [width, fontScale, now, selectedDate, onOpen, plans]);
  const getItemLayout = useCallback((_: unknown, index: number) => {
    const layout = yearRowLayout(index % rowsPerYear, fontScale);
    return { index, length: layout.length, offset: Math.floor(index / rowsPerYear) * sectionHeight + layout.offset };
  }, [fontScale, rowsPerYear, sectionHeight]);

  endBody();
  return (
    <FlatList
      ref={scroller}
      data={rows}
      renderItem={renderRow}
      keyExtractor={(item) => `${item.year}:${item.row}`}
      getItemLayout={getItemLayout}
      initialScrollIndex={RADIUS * rowsPerYear}
      initialNumToRender={4}
      maxToRenderPerBatch={2}
      updateCellsBatchingPeriod={16}
      // Three viewports, not two: at two, the current year's later months fall
      // outside the window and a reader opening the year view has to scroll to
      // reach September. A smaller window here is a UX regression, not a win.
      windowSize={3}
      onViewableItemsChanged={visibleRowsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      testID="year-pager"
      style={styles.root}
      contentContainerStyle={{ paddingBottom: bottomClearance }}
      onLayout={land}
      onScroll={reportYear}
      scrollEventThrottle={32}
      onMomentumScrollEnd={settle}
      onScrollEndDrag={(event) => { if (!event.nativeEvent.velocity?.y) settle(event); }}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
