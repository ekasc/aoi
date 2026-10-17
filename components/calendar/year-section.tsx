import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  buildMonthGrid,
  formatMonthTitle,
  isSameDay,
  isSameMonth,
  toDayKey,
} from '@/features/calendar/calendar-date-utils';
import {
  ownershipInkForTone,
  type EventOwnershipTone,
} from '@/features/calendar/event-ownership';
import { useThemeColor } from '@/hooks/use-theme-color';
import { beginPhase } from '@/features/dev/phase-timer';

/** Every row is the same fixed height, so the list opens on this year without
 *  measuring anything: the constant sets the layout instead of guessing it. */
const MINI_WEEKS = 6;
const MINI_ROW_HEIGHT = 24;
const MINI_NAME_HEIGHT = 28;
const MINI_MONTH_HEIGHT = MINI_NAME_HEIGHT + MINI_WEEKS * MINI_ROW_HEIGHT;
const MINI_GAP = Spacing[24];
const YEAR_TITLE_HEIGHT = 64;
const YEAR_SECTION_PADDING = Spacing[24];
export function yearSectionHeight(fontScale = 1): number {
  const rows = fontScale > 1.3 ? 12 : 6;
  return YEAR_SECTION_PADDING * 2 + Math.ceil(YEAR_TITLE_HEIGHT * fontScale)
    + rows * (Math.ceil(MINI_NAME_HEIGHT * fontScale) + MINI_WEEKS * Math.ceil(MINI_ROW_HEIGHT * fontScale))
    + (rows - 1) * MINI_GAP;
}
export const YEAR_SECTION_HEIGHT = yearSectionHeight();
const monthNameFormatter = new Intl.DateTimeFormat('en-US', { month: 'long' });

/** The month laid out as weeks, padded to a constant six rows. */
/**
 * The weeks a month actually occupies, four to six. Empty trailing weeks are
 * not padded in: the cell keeps a constant six-row height, so a month that
 * needs five rows simply leaves the last one blank, and padding it with a
 * second row of empty views only cost the year view a dozen views a month.
 */
function weeksOf(month: Date): Date[][] {
	const days = buildMonthGrid(month);
	const weeks: Date[][] = [];
	for (let index = 0; index < days.length; index += 7) {
		weeks.push(days.slice(index, index + 7));
	}
	return weeks.slice(0, MINI_WEEKS);
}

type MiniMonthProps = {
	month: Date;
	/** Two to a row, so the caller owns the width. */
	width: number;
	now: Date;
	selectedDate: Date;
	/** Whose plans each day holds, or null while they are being read. */
	planTones: Map<string, EventOwnershipTone> | null;
	onOpen: (month: Date) => void;
	fontScale: number;
};

const MiniMonth = memo(function MiniMonth({
	month,
	width,
	now,
	selectedDate,
	planTones,
	onOpen,
	fontScale,
}: MiniMonthProps) {
	const endMonth = beginPhase('year:mini-month');
	const accentInk = useThemeColor({}, 'accentInk');
	const partnerAccentInk = useThemeColor({}, 'partnerAccentInk');
	const textColor = useThemeColor({}, 'text');
	const weeks = useMemo(() => weeksOf(month), [month]);

	endMonth();
	return (
		<Pressable
			accessibilityHint="Opens the month in the calendar"
			accessibilityLabel={`Open ${formatMonthTitle(month)}`}
			accessibilityRole="button"
			onPress={() => onOpen(month)}
			accessibilityState={{ selected: isSameMonth(month, selectedDate) }}
			style={({ pressed }) => [
				styles.miniMonth,
				{ width, height: Math.ceil(MINI_NAME_HEIGHT * fontScale) + MINI_WEEKS * Math.ceil(MINI_ROW_HEIGHT * fontScale) },
				pressed ? styles.pressed : undefined,
			]}
		>
			<ThemedText type="bodyEmphasis" style={[styles.miniName, { height: Math.ceil(MINI_NAME_HEIGHT * fontScale) }]}>
				{monthNameFormatter.format(month)}
			</ThemedText>
			{weeks.map((week, weekIndex) => (
				<View key={`${month.getMonth()}:${weekIndex}`} style={styles.miniWeek}>
					{week.map((day) => {
						const inMonth = isSameMonth(day, month);
						const isToday = isSameDay(day, now);
						const isSelected = isSameDay(day, selectedDate);
						const tone = inMonth ? planTones?.get(toDayKey(day)) : undefined;
						return (
							<View key={day.toISOString()} style={[styles.miniDay, { height: Math.ceil(MINI_ROW_HEIGHT * fontScale) }]}>
								<ThemedText
									style={[
										styles.miniDayText,
										{
											color: isToday || isSelected ? accentInk : textColor,
											fontWeight: isToday || isSelected ? '700' : '400',
										},
									]}
								>
									{inMonth ? day.getDate() : ''}
								</ThemedText>
								{/* A day that holds plans carries a dot in its owner's
								    ink: the month grid's fills shrunk to a mark, so
								    colour — not a second signal — says whose it is.
								    Drawn only where there is a plan and pinned to the
								    cell's foot, so the 41 empty days a month cost no
								    view and the number never moves. */}
								{tone ? (
									<View
										accessible={false}
										style={[
											styles.miniDot,
											{
												backgroundColor: ownershipInkForTone(tone, {
													ownInkColor: accentInk,
													partnerInkColor: partnerAccentInk,
												}),
											},
										]}
										testID={`plans:${toDayKey(day)}`}
									/>
								) : null}
							</View>
						);
					})}
				</View>
			))}
		</Pressable>
	);
});

type YearSectionProps = {
	year: number;
	width: number;
	now: Date;
	selectedDate: Date;
	onOpen: (month: Date) => void;
};

export type YearPlans = {
  tones: Map<string, EventOwnershipTone> | null;
  failed: boolean;
};

export function yearRowCount(fontScale = 1): number {
  return fontScale > 1.3 ? 12 : 6;
}

export function yearRowLayout(row: number, fontScale = 1) {
  const monthHeight = Math.ceil(MINI_NAME_HEIGHT * fontScale) + MINI_WEEKS * Math.ceil(MINI_ROW_HEIGHT * fontScale);
  const step = monthHeight + MINI_GAP;
  const header = YEAR_SECTION_PADDING + Math.ceil(YEAR_TITLE_HEIGHT * fontScale);
  return { length: step + (row === 0 ? header : 0), offset: row === 0 ? 0 : header + row * step };
}

export const YearMonthRow = memo(function YearMonthRow({
  year, row, width, now, selectedDate, onOpen, plans,
}: YearSectionProps & { row: number; plans?: YearPlans }) {
  const endRow = beginPhase('year:row');
  const { fontScale } = useWindowDimensions();
  const muted = useThemeColor({}, 'muted');
  const columns = fontScale > 1.3 ? 1 : 2;
  const months = useMemo(() => Array.from({ length: columns }, (_, i) => new Date(year, row * columns + i, 1)), [columns, row, year]);
  const planTones = plans?.tones ?? null;
  const failed = plans?.failed ?? false;
  endRow();
  return (
    <View style={[styles.yearMonthRow, { height: yearRowLayout(row, fontScale).length }]}>
      {row === 0 ? (
        <View style={[styles.yearHeader, { height: Math.ceil(YEAR_TITLE_HEIGHT * fontScale) }]}>
          <ThemedText type="title">{year}</ThemedText>
          {failed || planTones === null || planTones.size === 0 ? (
            <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
              {failed ? 'Could not load plans' : planTones === null ? 'Loading plans…' : 'No plans this year'}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      <View style={styles.yearGrid}>
        {months.map((month) => (
          <MiniMonth key={month.getMonth()} month={month} width={width} now={now} selectedDate={selectedDate} onOpen={onOpen} planTones={planTones} fontScale={fontScale} />
        ))}
      </View>
    </View>
  );
});


/** Two mini months to a row, with a full gutter between them. */
export function yearMiniWidth(windowWidth: number, fontScale = 1): number {
  const columns = fontScale > 1.3 ? 1 : 2;
  return (windowWidth - YEAR_SECTION_PADDING * 2 - MINI_GAP * (columns - 1)) / columns;
}

const styles = StyleSheet.create({
  yearMonthRow: {
    paddingHorizontal: YEAR_SECTION_PADDING,
    justifyContent: 'flex-end',
    paddingBottom: MINI_GAP,
  },
	miniDay: {
		alignItems: 'center',
		flex: 1,
		height: MINI_ROW_HEIGHT,
		// The number sits at the cell's head, which is where it lands when a
		// dot fills the foot. The dot is out of flow, so both cases agree.
		justifyContent: 'flex-start',
	},
	miniDot: {
		// Out of flow, and explicitly centred: an absolute child with no
		// offsets would otherwise rely on the parent's alignItems.
		alignSelf: 'center',
		borderRadius: 999,
		bottom: 0,
		height: 4,
		position: 'absolute',
		width: 4,
	},
	miniDayText: {
		fontSize: 14,
		lineHeight: 18,
		fontVariant: ['tabular-nums'],
	},
	miniMonth: {
		height: MINI_MONTH_HEIGHT,
	},
	miniName: {
		height: MINI_NAME_HEIGHT,
	},
	miniWeek: {
		flexDirection: 'row',
	},
	yearGrid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: MINI_GAP,
		rowGap: MINI_GAP,
	},
	yearHeader: {
		gap: Spacing[4],
		height: YEAR_TITLE_HEIGHT,
	},
	pressed: { opacity: 0.65 },
});
