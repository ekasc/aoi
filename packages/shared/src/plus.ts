import { z } from 'zod';

/**
 * Space-level Plus entitlement contracts (P8A).
 *
 * Authority model: the backend row is authoritative for protected product
 * behavior. Client RevenueCat state remains useful for purchase/restore UX
 * only and must never grant features on its own.
 */

export const PLUS_PROVIDER = 'revenuecat' as const;

/** Lifecycle states a Space entitlement can be in. */
export const plusStatusSchema = z.enum(['active', 'inactive']);
export type PlusStatus = z.infer<typeof plusStatusSchema>;

/**
 * v1 benefit contract (P8B). Quotas are Space-level and shared by both
 * members. Free covers all core functionality; Plus raises the media
 * ceiling, removes the future-letter count cap, and unlocks PDF keepsakes.
 * Storage is never called "unlimited".
 */
export const FREE_MEDIA_BYTES = 250 * 1024 * 1024;
export const PLUS_MEDIA_BYTES = 5 * 1024 * 1024 * 1024;
/** Free Spaces hold one unopened future-sealed letter at a time. */
export const FREE_FUTURE_LETTERS = 1;

export function mediaLimitForSpace(isPlus: boolean): number {
  return isPlus ? PLUS_MEDIA_BYTES : FREE_MEDIA_BYTES;
}

/** Plus has no application-level count limit: null means unlimited. */
export function futureLetterLimitForSpace(isPlus: boolean): number | null {
  return isPlus ? null : FREE_FUTURE_LETTERS;
}

/**
 * Minimal RevenueCat webhook event surface — only the fields P8A actually
 * consumes. Unknown extra fields are ignored (future-proofing per RC docs).
 * Identity may arrive under any of app_user_id / original_app_user_id /
 * aliases: the server resolves all three against Aoi users and only acts on
 * an unambiguous single-user match. TRANSFER additionally carries
 * transferred_from[] / transferred_to[].
 */
export const revenueCatWebhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  app_user_id: z.string().min(1),
  original_app_user_id: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  transferred_from: z.array(z.string()).optional(),
  transferred_to: z.array(z.string()).optional(),
  event_timestamp_ms: z.number().int().nonnegative(),
  entitlement_id: z.string().optional(),
  entitlement_ids: z.array(z.string()).optional(),
  product_id: z.string().optional(),
  expiration_at_ms: z.number().int().nonnegative().optional(),
  store: z.string().optional(),
  environment: z.string().optional(),
});

export type RevenueCatWebhookEvent = z.infer<typeof revenueCatWebhookEventSchema>;

export const revenueCatWebhookBodySchema = z.object({
  api_version: z.string().optional(),
  event: revenueCatWebhookEventSchema,
});

export type RevenueCatWebhookBody = z.infer<typeof revenueCatWebhookBodySchema>;

/**
 * Event types that (re)assert an active paid period for our entitlement.
 * Anything else carrying our entitlement id is still recorded for ordering
 * but never grants.
 */
export const PLUS_GRANT_EVENT_TYPES = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'RESUBSCRIBE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
] as const;

/** Event types that end paid access at (or before) the carried expiration. */
export const PLUS_REVOKE_EVENT_TYPES = ['EXPIRATION'] as const;

/**
 * Authenticated Space Plus read contract. Both active members of the same
 * Space receive the identical row; callers without an active Space always
 * observe inactive (which reveals nothing about other Spaces).
 *
 * Usage fields let Space UI/paywall show truthful current limits. Counts
 * and bytes describe the caller's own Space only.
 */
export const spacePlusResponseSchema = z.object({
  isPlus: z.boolean(),
  status: plusStatusSchema,
  /** ISO expiry of the paid period, or null when open-ended/unknown. */
  expiresAt: z.string().nullable(),
  /** Sum of counted media bytes (pending + complete, non-deleted). */
  mediaUsedBytes: z.number().int().nonnegative(),
  /** Current media ceiling for this Space. */
  mediaLimitBytes: z.number().int().positive(),
  /** Unopened future-sealed letters; due-but-unopened still counts until opened. */
  activeFutureLetters: z.number().int().nonnegative(),
  /** Current future-letter allowance; null means unlimited (Plus). */
  futureLetterLimit: z.number().int().positive().nullable(),
});

export type SpacePlusResponse = z.infer<typeof spacePlusResponseSchema>;

/**
 * Machine-readable limit payload carried on LIMIT_EXCEEDED errors.
 * Numbers only — no storage internals, no other-Space data.
 */
export const limitDetailsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('media_quota'),
    usedBytes: z.number().int().nonnegative(),
    limitBytes: z.number().int().positive(),
    plusLimitBytes: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('future_letters'),
    usedCount: z.number().int().nonnegative(),
    limitCount: z.number().int().positive(),
  }),
]);

export type LimitDetails = z.infer<typeof limitDetailsSchema>;
