import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import sharp from 'sharp';
import { z } from 'zod';

import { db } from '../db/index.js';
import { mediaObjects, spaceMembers } from '../db/schema.js';
import { badRequest, internal, notFound, forbidden } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';

const mediaRouter = new Hono();

// Stricter rate limit for upload endpoints to prevent presigned URL abuse
const uploadRateLimit = rateLimit({
  max: 20,
  windowSec: 60,
  keyFn: (c) => c.var.userId ?? 'unknown',
});

// ── R2 Client ────────────────────────────────────────────────────────────

/** Strip characters that could interfere with HTTP header parsing */
function sanitizeFilename(name: string): string {
  return name.replace(/["\n\r\\;]/g, '_').substring(0, 255);
}

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const R2_BUCKET = process.env.R2_BUCKET ?? 'aoi-media';

// ── Helper: get user's active space ──────────────────────────────────────

async function getActiveSpaceId(userId: string): Promise<string | null> {
  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);
  return membership.length > 0 ? membership[0].spaceId : null;
}

// ── Request upload URL ───────────────────────────────────────────────────

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;

// Voice traces: device-recorded audio formats only.
const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
] as const;

const ALLOWED_MEDIA_MIME_TYPES: readonly string[] = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_AUDIO_MIME_TYPES,
];

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z
    .string()
    .min(1)
    .max(100)
    .refine(
      (val) => ALLOWED_MEDIA_MIME_TYPES.includes(val),
      { message: `Unsupported MIME type. Allowed: ${ALLOWED_MEDIA_MIME_TYPES.join(', ')}` }
    ),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024), // max 100MB
});

mediaRouter.post('/v1/media/upload-url', uploadRateLimit, zValidator('json', uploadUrlSchema), async (c) => {
  const userId = c.var.userId;
  const spaceId = await getActiveSpaceId(userId);

  if (!spaceId) {
    throw badRequest('You must have an active space to upload media');
  }

  const { filename, mimeType, sizeBytes } = c.req.valid('json');

  // Generate a unique storage key
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const storageKey = `${spaceId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  // Create media object record
  const [media] = await db
    .insert(mediaObjects)
    .values({
      spaceId,
      createdByUserId: userId,
      filename,
      mimeType,
      sizeBytes: String(sizeBytes),
      storageKey,
      uploadState: 'pending',
    })
    .returning();

  // Generate presigned upload URL
  const r2 = getR2Client();
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });

  return c.json({
    id: media.id,
    uploadUrl,
    storageKey,
    expiresInSec: 3600,
  }, 201);
});

// ── Confirm upload complete ──────────────────────────────────────────────

async function stripExifForMedia(media: typeof mediaObjects.$inferSelect, r2: S3Client): Promise<void> {
  if (!media.mimeType.startsWith('image/')) return;

  try {
    const getCommand = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: media.storageKey,
    });

    const { Body } = await r2.send(getCommand);
    if (!Body) return;

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const stripped = await sharp(buffer).toBuffer();

    const putCommand = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: media.storageKey,
      Body: stripped,
      ContentType: media.mimeType,
    });

    await r2.send(putCommand);
  } catch (err) {
    console.warn('EXIF stripping failed for media', media.id, err instanceof Error ? err.message : err);
  }
}

mediaRouter.post('/v1/media/:id/complete', uploadRateLimit, zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const userId = c.var.userId;
  const mediaId = c.req.param('id');

  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaId), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!media) {
    throw notFound('Media not found');
  }

  if (media.createdByUserId !== userId) {
    throw forbidden('You can only confirm your own uploads');
  }

  if (media.uploadState !== 'pending') {
    throw badRequest('Upload is already completed');
  }

  // Verify stored object's ContentType matches what was claimed
  const r2 = getR2Client();
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: media.storageKey,
    });
    const headResult = await r2.send(headCommand);
    const storedType = headResult.ContentType;
    if (storedType && storedType !== media.mimeType) {
      await db
        .update(mediaObjects)
        .set({ uploadState: 'failed' })
        .where(eq(mediaObjects.id, mediaId));
      throw badRequest('Uploaded content type does not match declared MIME type');
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw internal('Failed to verify uploaded content');
  }

  await db
    .update(mediaObjects)
    .set({ uploadState: 'complete' })
    .where(eq(mediaObjects.id, mediaId));

  // Strip EXIF metadata server-side for image privacy (best-effort, fire-and-forget)
  void stripExifForMedia(media, r2);

  return c.json({ ok: true });
});

// ── Get download URL ─────────────────────────────────────────────────────

mediaRouter.get('/v1/media/:id/download-url', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const userId = c.var.userId;
  const mediaId = c.req.param('id');

  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaId), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!media) {
    throw notFound('Media not found');
  }

  if (media.uploadState !== 'complete') {
    throw badRequest('Upload is not yet complete');
  }

  // Verify user has access to the space
  const [membership] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, media.spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  if (!membership) {
    throw forbidden('You do not have access to this media');
  }

  const r2 = getR2Client();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: media.storageKey,
    ResponseContentDisposition: `inline; filename="${sanitizeFilename(media.filename)}"`,
  });

  const downloadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });

  return c.json({
    downloadUrl,
    filename: media.filename,
    mimeType: media.mimeType,
    expiresInSec: 3600,
  });
});

export { mediaRouter };
