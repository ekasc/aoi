import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { PaperTextInput } from '@/components/ui/text-input';
import { Radii, Spacing } from '@/constants/theme';
import {
	formatDateTitle,
	formatEventTimeLabel,
	toDayKey,
} from '@/features/calendar/calendar-date-utils';
import { useCalendar } from '@/features/calendar/calendar-context';
import { matchEvents, searchRange } from '@/features/calendar/search';
import type { CalendarEvent } from '@/features/calendar/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Search across the calendar: one bounded read of the whole window, then
 * matching in memory, so typing never waits on the network and a query cannot
 * race a previous one.
 */
export default function CalendarSearchScreen() {
	const router = useRouter();
	const { eventsInRange } = useCalendar();
	const [query, setQuery] = useState('');
	// Typing stays responsive while matching catches up.
	const deferredQuery = useDeferredValue(query);
	const [events, setEvents] = useState<CalendarEvent[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const generation = useRef(0);

	const border = useThemeColor({}, 'border');
	const muted = useThemeColor({}, 'muted');
	const accentInk = useThemeColor({}, 'accentInk');
	const partnerAccentInk = useThemeColor({}, 'partnerAccentInk');

	const load = useCallback(async () => {
		const current = generation.current + 1;
		generation.current = current;
		setError(null);
		setEvents(null);
		try {
			const { from, to } = searchRange();
			const loaded = await eventsInRange(from, to);
			if (generation.current === current) {
				setEvents(loaded);
			}
		} catch {
			if (generation.current === current) {
				setError('Could not load your events.');
			}
		}
	}, [eventsInRange]);

	useEffect(() => {
		void load();
		return () => {
			// A read that lands after the screen closes has nowhere to go.
			generation.current += 1;
		};
	}, [load]);

	const hits = useMemo(
		() => (events ? matchEvents(events, deferredQuery) : []),
		[deferredQuery, events],
	);

	const days = useMemo(() => {
		const byDay = new Map<string, CalendarEvent[]>();
		for (const event of hits) {
			const key = toDayKey(new Date(event.startsAt));
			const day = byDay.get(key);
			if (day) {
				day.push(event);
			} else {
				byDay.set(key, [event]);
			}
		}
		return Array.from(byDay.entries());
	}, [hits]);

	const trimmed = deferredQuery.trim();
	const status = useMemo(() => {
		if (error) {
			return error;
		}
		if (events === null) {
			return 'Loading your events';
		}
		if (trimmed.length === 0) {
			return 'Type to search titles, labels or a name';
		}
		return hits.length === 1 ? '1 event' : `${hits.length} events`;
	}, [error, events, hits.length, trimmed]);

	return (
		<View style={styles.root}>
			<View style={styles.field}>
				<PaperTextInput
					accessibilityLabel="Search events"
					autoCapitalize="none"
					autoCorrect={false}
					clearButtonMode="while-editing"
					label="Search events"
					onChangeText={setQuery}
					placeholder="Career fair, gym, June"
					returnKeyType="search"
					value={query}
				/>
			</View>

			<ThemedText
				accessibilityLiveRegion="polite"
				type="caption"
				style={[styles.status, { color: muted }]}
			>
				{status}
			</ThemedText>

			{error ? (
				<View accessibilityRole="alert" style={styles.errorBox}>
					<Button label="Try again" onPress={() => void load()} size="sm" variant="secondary" />
				</View>
			) : null}

			{events === null && !error ? (
				<ActivityIndicator color={accentInk} style={styles.spinner} />
			) : null}

			{!error && events !== null && (events.length === 0 || (trimmed.length > 0 && hits.length === 0)) ? (
				<ThemedText accessibilityLiveRegion="polite" type="body" style={[styles.empty, { color: muted }]}>
					{events.length === 0 ? 'No events in this search range.' : `Nothing matches "${trimmed}".`}
				</ThemedText>
			) : null}

			<ScrollView
				contentContainerStyle={styles.results}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				{days.map(([dayKey, dayEvents]) => (
					<View key={dayKey} style={styles.day}>
						<ThemedText type="meta" style={{ color: muted }}>
							{formatDateTitle(new Date(dayEvents[0].startsAt))}
						</ThemedText>
						{dayEvents.map((event) => (
							<Pressable
								accessibilityLabel={`Open ${event.title}, ${formatEventTimeLabel(event)}`}
								accessibilityRole="button"
								key={event.id}
								onPress={() => router.push(`/(app)/calendar/edit/${event.id}`)}
								style={({ pressed }) => [
									styles.row,
									{ borderBottomColor: border },
									pressed ? styles.pressed : undefined,
								]}
							>
								<View
									style={[
										styles.authorDot,
										{
											backgroundColor:
												event.isOwn && !event.together ? accentInk : partnerAccentInk,
										},
									]}
								/>
								<ThemedText type="caption" style={[styles.when, { color: muted }]}>
									{event.allDay ? 'All day' : formatEventTimeLabel(event)}
								</ThemedText>
								<ThemedText numberOfLines={2} type="body" style={styles.title}>
									{event.title}
								</ThemedText>
							</Pressable>
						))}
					</View>
				))}
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	authorDot: {
		borderRadius: 4,
		height: 8,
		width: 8,
	},
	day: {
		gap: Spacing[4],
	},
	empty: {
		paddingHorizontal: Spacing[24],
		paddingVertical: Spacing[16],
	},
	errorBox: {
		paddingHorizontal: Spacing[24],
		paddingVertical: Spacing[8],
	},
	field: {
		paddingHorizontal: Spacing[24],
		paddingTop: Spacing[8],
	},
	pressed: {
		opacity: 0.85,
	},
	results: {
		gap: Spacing[16],
		paddingBottom: Spacing[40],
		paddingHorizontal: Spacing[24],
		paddingTop: Spacing[8],
	},
	root: {
		flex: 1,
	},
	row: {
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.sm,
		flexDirection: 'row',
		gap: Spacing[8],
		minHeight: 44,
	},
	spinner: {
		paddingVertical: Spacing[24],
	},
	status: {
		paddingHorizontal: Spacing[24],
		paddingVertical: Spacing[8],
	},
	title: {
		flex: 1,
	},
	when: {
		minWidth: 72,
	},
});
