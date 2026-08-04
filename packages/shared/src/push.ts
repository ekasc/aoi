/**
 * Push notification contract types shared by the API and the client.
 *
 * Privacy rule: push payloads carry a `kind` and vague copy only — never
 * moment text, locations, or answers. The API builds titles/bodies from the
 * kind alone; nothing content-shaped ever enters a payload.
 */

export const PUSH_TOKEN_PLATFORMS = ['ios', 'android', 'web', 'unknown'] as const;

export type PushTokenPlatform = (typeof PUSH_TOKEN_PLATFORMS)[number];

export const PUSH_NOTIFICATION_KINDS = [
  'squeeze',
  'moment_added',
  'moment_edited',
  'moment_deleted',
  'location_request',
  'location_granted',
  'location_stopped',
] as const;

export type PushNotificationKind = (typeof PUSH_NOTIFICATION_KINDS)[number];

/** The only structured data a push ever carries — kind only, never content. */
export type PushNotificationData = {
  kind: PushNotificationKind;
};

export type RegisterPushTokenRequest = {
  expoPushToken: string;
  platform?: PushTokenPlatform;
};

export type RegisterPushTokenResponse = {
  id: string;
  platform: PushTokenPlatform;
};

export type UnregisterPushTokenRequest = {
  expoPushToken: string;
};

const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

/**
 * Pure format check for Expo push tokens (`ExponentPushToken[...]` legacy or
 * `ExpoPushToken[...]` current). Shared by the API zod schema and the client
 * so both sides validate identically.
 */
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && EXPO_PUSH_TOKEN_PATTERN.test(value);
}

/**
 * Narrow an incoming push `data` payload (untrusted, native-origin) to the
 * known contract shape. Returns null for anything unrecognized — receivers
 * must never act on unknown kinds.
 */
export function parsePushNotificationData(
  data: unknown
): PushNotificationData | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const kind = (data as Record<string, unknown>).kind;

  if (
    typeof kind === 'string' &&
    (PUSH_NOTIFICATION_KINDS as readonly string[]).includes(kind)
  ) {
    return { kind: kind as PushNotificationKind };
  }

  return null;
}
