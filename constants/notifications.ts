/**
 * Notifications are off for now.
 *
 * They cannot be exercised where this app is being developed: Expo Go on
 * Android never delivers one, so every path here is a permission prompt and a
 * scheduler nobody can watch work. Everything that would ask for permission,
 * register a device token, schedule a reminder, or route an incoming push
 * reads this first — so switching them back on is this one line, and nothing
 * that was written for them had to be deleted.
 *
 * Flip it when notifications can be tested for real: a development build on
 * both platforms.
 */
export const NOTIFICATIONS_ENABLED = false;
