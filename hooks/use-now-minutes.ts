import { useEffect, useState } from 'react';

/** Minutes since local midnight. */
export function minutesOfDay(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

const msIntoMinute = (date: Date) =>
	date.getSeconds() * 1000 + date.getMilliseconds();

/**
 * The current minute of the day, so a timeline can draw where "now" falls.
 *
 * It wakes on the next minute boundary rather than on a fixed interval, so a
 * line drawn from it never drifts a second further behind the clock the longer
 * the screen stays open. It ticks only while `today`, so looking at another
 * day costs nothing.
 */
export function useNowMinutes(today: boolean): number {
	const [minutes, setMinutes] = useState(() => minutesOfDay(new Date()));

	useEffect(() => {
		if (!today) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			setMinutes(minutesOfDay(new Date()));
			timer = setTimeout(tick, 60_000 - msIntoMinute(new Date()) + 20);
		};
		// A zero-delay first tick keeps the value fresh the moment the line is
		// switched on, without setting state synchronously in the effect body
		// (which would cascade a render).
		timer = setTimeout(tick, 0);
		return () => {
			if (timer) {
				clearTimeout(timer);
			}
		};
	}, [today]);

	return minutes;
}
