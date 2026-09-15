import { z } from 'zod';

import { mediaKindSchema } from './media';

/**
 * Ordered multi-attachment contract (unified memory composer).
 *
 * Input is `{ mediaId, kind }` only — ordered, max 10 (bounded
 * payload/picker). `.strict()` rejects any device URI / URL / remote-URL
 * path: attachments may only reference uploaded media objects by id.
 * `kind` is `image | audio` only — video is NOT allowed until a privacy
 * stripping + playback pipeline exists.
 */
export const MOMENT_ATTACHMENT_MAX = 10;

export const momentAttachmentInputSchema = z
  .object({
    mediaId: z.string().uuid(),
    kind: mediaKindSchema,
  })
  .strict();

export type MomentAttachmentInput = z.infer<typeof momentAttachmentInputSchema>;

const attachmentsInputArraySchema = z
  .array(momentAttachmentInputSchema)
  .max(MOMENT_ATTACHMENT_MAX)
  .refine((items) => new Set(items.map((item) => item.mediaId)).size === items.length, {
    message: 'Duplicate media ids',
  });

/**
 * Response attachment: stable member-authorized serve URL.
 * `url` is `mediaObjectUrl(mediaId, 'display')` for images and
 * `mediaObjectUrl(mediaId, 'original')` for audio — the actual serving
 * APIs, never a persisted signed URL or device URI.
 */
export const momentAttachmentSchema = z.object({
  mediaId: z.string().uuid(),
  kind: mediaKindSchema,
  url: z.string().min(1),
});

export type MomentAttachment = z.infer<typeof momentAttachmentSchema>;

export const MOMENT_TYPES = [
  'note',
  'milestone',
  'date',
  'goal',
  'media',
  'trace',
] as const;

export const momentTypeSchema = z.enum(MOMENT_TYPES);

export type MomentType = z.infer<typeof momentTypeSchema>;

export const MOMENT_AUTHOR_ROLES = ['you', 'partner'] as const;

export const momentAuthorRoleSchema = z.enum(MOMENT_AUTHOR_ROLES);

export type MomentAuthorRole = z.infer<typeof momentAuthorRoleSchema>;

export const momentSchema = z.object({
  id: z.string(),
  type: momentTypeSchema,
  title: z.string(),
  body: z.string(),
  occurredAt: z.string(),
  targetAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  authorId: z.string(),
  authorRole: momentAuthorRoleSchema,
  authorName: z.string(),
  /**
   * Per-request ownership signal: true only when the requesting user authored
   * the moment. Clients must gate edit/delete on this (never on authorRole
   * alone) and treat a missing value as "not own".
   */
  isOwn: z.boolean(),
  mediaPreview: z.string().nullable().optional(),
  audioUri: z.string().nullable().optional(),
  /**
   * Stable media object id (media_objects.id) when the moment carries
   * media. Always paired with a stable serve URL in mediaPreview/audioUri;
   * clients build variants via /v1/media/:id/object?variant=… and must
   * never persist signed URLs.
   */
  mediaId: z.string().nullable().optional(),
  /**
   * Ordered attachments (image/audio only). Defaults to `[]` so payloads
   * recorded before attachments still parse; the server always sends the
   * array on list/timeline/range/create/update.
   */
  attachments: z.array(momentAttachmentSchema).max(MOMENT_ATTACHMENT_MAX).default([]),
  /**
   * Per-viewer read state for the bidirectional timeline. Optional so
   * existing list/create/update paths stay backwards-compatible;
   * the timeline endpoint always returns it.
   */
  isRead: z.boolean().optional(),
});

export type Moment = z.infer<typeof momentSchema>;

export const createMomentRequestSchema = z.object({
  type: momentTypeSchema,
  title: z.string().optional(),
  body: z.string().optional(),
  occurredAt: z.string().optional(),
  targetAt: z.string().nullable().optional(),
  mediaPreview: z.string().nullable().optional(),
  audioUri: z.string().nullable().optional(),
  mediaId: z.string().nullable().optional(),
  /**
   * Ordered attachments (image/audio only, max 10). Omitted = legacy
   * single-media path (old fields stored as-supplied, attachments stay
   * empty unless derived at read). Supplied (even `[]`) = the attachment
   * set for the new moment; legacy `mediaPreview`/`audioUri`/`mediaId`
   * are derived from the first image/audio attachment for old clients.
   * No device URI or remote URL is accepted here — only uploaded media ids.
   */
  attachments: attachmentsInputArraySchema.optional(),
  /**
   * Optional idempotency key: a client-supplied stable id (e.g. derived from
   * the client's draft). When present, a duplicate create with the same
   * `clientId` inside the same space is a no-op instead of a second row.
   */
  clientId: z.string().min(1).max(64).optional(),
});

export type CreateMomentRequest = z.infer<typeof createMomentRequestSchema>;

export const updateMomentRequestSchema = z.object({
  type: momentTypeSchema.optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  occurredAt: z.string().optional(),
  targetAt: z.string().nullable().optional(),
  mediaPreview: z.string().nullable().optional(),
  audioUri: z.string().nullable().optional(),
  mediaId: z.string().nullable().optional(),
  /**
   * Optional attachment replacement. Omitted = attachments untouched (legacy
   * single-media fields update independently as before). Supplied (including
   * `[]` to clear) = atomically replace the full ordered set; legacy
   * `mediaPreview`/`audioUri`/`mediaId` are re-derived from the new set for
   * old clients. Ownership + same-space + complete + MIME-kind match are
   * enforced per entry.
   */
  attachments: attachmentsInputArraySchema.optional(),
});

export type UpdateMomentRequest = z.infer<typeof updateMomentRequestSchema>;

export const momentListResponseSchema = z.object({
  moments: z.array(momentSchema),
  nextCursor: z.string().optional(),
});

export type MomentListResponse = z.infer<typeof momentListResponseSchema>;

/**
 * GET /v1/spaces/current/moments query params.
 * `cursor` is the opaque composite key `occurredAtMs|id` (legacy bare ISO
 * datetimes are also accepted for one page). `limit` ∈ [1, 100], default 20.
 * `fromMs`/`toMs` optionally bound occurred_at to [fromMs, toMs) — epoch ms,
 * validated in the domain (finite, fromMs < toMs, span ≤ 400 days) so a
 * chapter range can page to completion without ever crawling the archive.
 * Ranged reads also apply chapter eligibility (note/media/trace only).
 */
export const listMomentsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  fromMs: z.coerce.number().int().min(0).optional(),
  toMs: z.coerce.number().int().min(0).optional(),
  /** Optional single-type filter (e.g. Plans-owned goal reads). */
  type: momentTypeSchema.optional(),
});

export type ListMomentsQuery = z.infer<typeof listMomentsQuerySchema>;

/**
 * Chapter-discovery bucket summary. The client computes absolute local-time
 * bounds ([fromMs, toMs)) for the calendar periods it wants — the server
 * performs zero timezone math and simply counts/finds-covers inside each
 * bucket. Buckets are disjoint by construction, so pages can never
 * duplicate or skip rows; `hasOlder` tells the client whether any eligible
 * memory predates the earliest bucket (explicit exhaustion).
 */
export const bucketBoundsSchema = z.object({
  fromMs: z.coerce.number().int().min(0),
  toMs: z.coerce.number().int().min(0),
});

export type BucketBounds = z.infer<typeof bucketBoundsSchema>;

export const bucketSummarySchema = bucketBoundsSchema.extend({
  count: z.number().int().min(0),
  cover: z.string().nullable(),
});

export type BucketSummary = z.infer<typeof bucketSummarySchema>;

export const bucketSummaryResponseSchema = z.object({
  buckets: z.array(bucketSummarySchema).max(24),
  hasOlder: z.boolean(),
});

export type BucketSummaryResponse = z.infer<typeof bucketSummaryResponseSchema>;

/**
 * GET /v1/spaces/current/moments/summary query params. `buckets` is a comma
 * separated list of `fromMs:toMs` pairs (1–24 buckets; each pair validated
 * in the domain: finite, fromMs < toMs, span ≤ 400 days).
 */
export const bucketSummaryQuerySchema = z.object({
  buckets: z.string().min(1).max(4000),
});

export type BucketSummaryQuery = z.infer<typeof bucketSummaryQuerySchema>;

/** Path param for PATCH/DELETE /v1/moments/:id (server-generated UUIDs). */
export const momentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type MomentIdParam = z.infer<typeof momentIdParamSchema>;

/**
 * Bidirectional chronological timeline (chat-style, latest at bottom).
 * Timeline eligibility is visible-only: live moments excluding goals
 * (`deleted_at IS NULL AND type != 'goal'`). Own moments are included as
 * intrinsically read; unread excludes own + read rows.
 *
 * Cursors are the opaque composite key `occurredAtMs|id` (same encoding as
 * the legacy list). `before`/`after`/`anchor` are mutually exclusive:
 * `before` pages older (strictly `<` cursor, response ascending), `after`
 * pages newer (strictly `>` cursor). `anchor` is a saved-composer entry id
 * (UUID) that centers the same bounded window on that record instead of
 * the server-computed FIRST unread. No cursor returns a bounded window
 * around the server-computed FIRST unread (half before, anchor + after);
 * with no unread it returns the latest window.
 */
export const timelineQuerySchema = z
  .object({
    before: z.string().max(200).optional(),
    after: z.string().max(200).optional(),
    anchor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine(
    (value) =>
      [value.before, value.after, value.anchor].filter((entry) => entry !== undefined).length <= 1,
    {
      message: 'Only one of before, after, or anchor may be provided',
    }
  );

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const timelineFirstUnreadSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
});

export type TimelineFirstUnread = z.infer<typeof timelineFirstUnreadSchema>;

export const timelineResponseSchema = z.object({
  moments: z.array(momentSchema),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
  firstUnread: timelineFirstUnreadSchema.nullable(),
  unreadCount: z.number().int().min(0),
});

export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

/**
 * POST /v1/spaces/current/moments/read. Small bounded batch of moment ids
 * to mark read for the caller. The caller id is never accepted from the
 * client — it comes from the session. Only eligible moments in the
 * caller's active space take effect (partner-visible, live, non-goal,
 * not own); everything else is silently skipped. Idempotent.
 */
export const markMomentsReadRequestSchema = z.object({
  momentIds: z.array(z.string().uuid()).min(1).max(100),
});

export type MarkMomentsReadRequest = z.infer<typeof markMomentsReadRequestSchema>;

export const markMomentsReadResponseSchema = z.object({
  ok: z.literal(true),
});

export type MarkMomentsReadResponse = z.infer<typeof markMomentsReadResponseSchema>;
