import type { CalendarEvent } from './types';

/** How far either side of today a search looks. */
export const SEARCH_WINDOW_DAYS = 730;

export type SearchRange = { from: Date; to: Date };

/** The window a search reads. Wide enough to feel like everything, bounded
 *  enough that a remote read stays one request. */
export function searchRange(now: Date = new Date()): SearchRange {
	const from = new Date(now);
	from.setDate(from.getDate() - SEARCH_WINDOW_DAYS);
	from.setHours(0, 0, 0, 0);
	const to = new Date(now);
	to.setDate(to.getDate() + SEARCH_WINDOW_DAYS);
	to.setHours(23, 59, 59, 999);
	return { from, to };
}

/** Everything a query is matched against, so a label is searchable too. */
export function eventSearchText(event: CalendarEvent): string {
	return [
		event.title,
		event.label?.preset ?? '',
		event.label?.customText ?? '',
		event.actorName ?? '',
	]
		.join(' ')
		.toLowerCase();
}

/**
 * Matches on any word the query holds, in any order, so "gym friday" finds a
 * Friday gym session without the words being adjacent or in that order.
 */
export function matchEvents(events: CalendarEvent[], query: string): CalendarEvent[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter((term) => term.length > 0);
	if (terms.length === 0) {
		return [];
	}
	return events
		.filter((event) => {
			const haystack = eventSearchText(event);
			return terms.every((term) => haystack.includes(term));
		})
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
