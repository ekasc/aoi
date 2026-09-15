import { z } from 'zod';

export const PUSH_TOKEN_PLATFORMS = ['ios', 'android', 'web', 'unknown'] as const;

export const pushTokenPlatformSchema = z.enum(PUSH_TOKEN_PLATFORMS);

export type PushTokenPlatform = z.infer<typeof pushTokenPlatformSchema>;

export const PUSH_NOTIFICATION_KINDS = [
  'squeeze',
  'moment_added',
  'moment_edited',
  'moment_deleted',
  'location_request',
  'location_granted',
  'location_stopped',
  'letter_sealed',
  'event_added',
  'event_updated',
  'event_deleted',
  'proposal_received',
  'proposal_accepted',
  'proposal_declined',
] as const;

export const pushNotificationKindSchema = z.enum(PUSH_NOTIFICATION_KINDS);

export type PushNotificationKind = z.infer<typeof pushNotificationKindSchema>;

/** The only structured data a push ever carries — kind only, never content. */
export const pushNotificationDataSchema = z.object({
  kind: pushNotificationKindSchema,
});

export type PushNotificationData = z.infer<typeof pushNotificationDataSchema>;

/** Upper bound for a stored Expo push token (shared by API validation). */
export const PUSH_TOKEN_MAX_LENGTH = 200;

export const registerPushTokenRequestSchema = z.object({
  expoPushToken: z
    .string()
    .min(1)
    .max(PUSH_TOKEN_MAX_LENGTH)
    .refine(isExpoPushToken, { message: 'Invalid push token format' }),
  platform: pushTokenPlatformSchema.optional(),
});

export type RegisterPushTokenRequest = z.infer<
  typeof registerPushTokenRequestSchema
>;

export const registerPushTokenResponseSchema = z.object({
  id: z.string(),
  platform: pushTokenPlatformSchema,
});

export type RegisterPushTokenResponse = z.infer<
  typeof registerPushTokenResponseSchema
>;

export const unregisterPushTokenRequestSchema = z.object({
  expoPushToken: z.string(),
});

export type UnregisterPushTokenRequest = z.infer<
  typeof unregisterPushTokenRequestSchema
>;

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
