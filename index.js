import { guardPushNotificationIOS } from '@/features/notifications/notifications-module';
import 'expo-router/entry';

// First module body to run: neutralize React Native's PushNotificationIOS
// getter before any route chunk or HMR update can enumerate it (Metro's
// importAll walks lazy getters, and the native push module is absent from
// capability-stripped builds, which fatals at load). See app/_layout, which
// repeats the call for entry points that bypass this file; the guard is
// idempotent.
guardPushNotificationIOS();
