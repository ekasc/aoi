import { z } from 'zod';

/**
 * Media contract — stable IDs and stable app URLs only. The client never
 * persists presigned/durable signed URLs; every serve goes through
 * `/v1/media/:id/object?variant=…`, backed by the private R2 bucket.
 */

export const MEDIA_UPLOAD_STATES = ['pending', 'complete', 'failed'] as const;

export const mediaUploadStateSchema = z.enum(MEDIA_UPLOAD_STATES);

export type MediaUploadState = z.infer<typeof mediaUploadStateSchema>;

/** Original source; display (re-encoded WebP); bounded thumbnail. */
export const MEDIA_VARIANTS = ['original', 'display', 'thumb'] as const;

export const mediaVariantSchema = z.enum(MEDIA_VARIANTS);

export type MediaVariant = z.infer<typeof mediaVariantSchema>;

export const MEDIA_KINDS = ['image', 'audio'] as const;

export const mediaKindSchema = z.enum(MEDIA_KINDS);

export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Hard cap for a single upload (matches the R2/sanitizer budget). */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const MEDIA_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;

export const MEDIA_AUDIO_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
] as const;

export const MEDIA_ALLOWED_MIME_TYPES = [
  ...MEDIA_IMAGE_MIME_TYPES,
  ...MEDIA_AUDIO_MIME_TYPES,
] as const;

/** Server-side MIME allow-list check (shared by validation + sanitizer). */
export function isAllowedMediaMimeType(
  value: unknown
): value is (typeof MEDIA_ALLOWED_MIME_TYPES)[number] {
  return (
    typeof value === 'string' &&
    (MEDIA_ALLOWED_MIME_TYPES as readonly string[]).includes(value)
  );
}

export const mediaObjectSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  createdByUserId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Stable R2 key (content-hash based). Never a signed URL. */
  storageKey: z.string(),
  uploadState: mediaUploadStateSchema,
  contentHash: z.string().nullable().optional(),
  /** variant → R2 key map, populated by the sanitizer. */
  variantKeys: z.record(mediaVariantSchema, z.string()).nullable().optional(),
  processingAttempts: z.number().int().nonnegative().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  deletedAt: z.string().nullable().optional(),
});

export type MediaObject = z.infer<typeof mediaObjectSchema>;

/** POST /v1/media/upload-url — intent to upload. */
export const mediaUploadIntentRequestSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
  kind: mediaKindSchema,
});

export type MediaUploadIntentRequest = z.infer<
  typeof mediaUploadIntentRequestSchema
>;

export const mediaUploadIntentResponseSchema = z.object({
  mediaId: z.string(),
  /** Short-lived S3 presigned PUT for the direct upload (per-request only). */
  uploadUrl: z.string(),
  expiresInSec: z.number(),
  /** Required request headers for the PUT (e.g. Content-Type). */
  headers: z.record(z.string(), z.string()).optional(),
});

export type MediaUploadIntentResponse = z.infer<
  typeof mediaUploadIntentResponseSchema
>;

/** POST /v1/media/:id/complete — confirm upload, kick off sanitization. */
export const mediaCompleteRequestSchema = z.object({
  mediaId: z.string(),
});

export type MediaCompleteRequest = z.infer<typeof mediaCompleteRequestSchema>;

/** GET /v1/media/:id/object?variant=… — stable serve URL params. */
export const mediaObjectServeQuerySchema = z.object({
  variant: mediaVariantSchema.optional(),
});

export type MediaObjectServeQuery = z.infer<typeof mediaObjectServeQuerySchema>;

/**
 * The stable app URL for a media object. Clients persist THIS (plus the
 * media id), never a presigned URL.
 */
export function mediaObjectUrl(mediaId: string, variant: MediaVariant = 'display'): string {
  return `/v1/media/${mediaId}/object?variant=${variant}`;
}
