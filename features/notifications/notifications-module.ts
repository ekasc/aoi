import { NOTIFICATIONS_ENABLED } from '@/constants/notifications';

/** The module's own shape, taken from its types. */
export type NotificationsModule = typeof import('expo-notifications');

let loaded: NotificationsModule | null | undefined;

/**
 * The notifications module, or null where it must not be used.
 *
 * Importing `expo-notifications` is itself the failure in Expo Go on Android:
 * the module throws as it loads, before any call is made, so a top-level
 * import cannot be defended against by guarding the calls. Everything that
 * needs it asks here instead, and the require is only reached once
 * `NOTIFICATIONS_ENABLED` says notifications are on.
 */
export function notificationsModule(): NotificationsModule | null {
	if (!NOTIFICATIONS_ENABLED) {
		return null;
	}
	if (loaded === undefined) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above: a static import throws on Android in Expo Go.
			loaded = require('expo-notifications') as NotificationsModule;
		} catch {
			loaded = null;
		}
	}
	return loaded;
}
