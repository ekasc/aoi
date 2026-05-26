import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull } from 'drizzle-orm';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db } from '../db/index.js';
import { mediaObjects, spaceMembers } from '../db/schema.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';

const mediaRouter = new Hono();

// ── R2 Client ────────────────────────────────────────────────────────────

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

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024), // max 100MB
});

mediaRouter.post('/v1/media/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
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

mediaRouter.post('/v1/media/:id/complete', async (c) => {
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

  await db
    .update(mediaObjects)
    .set({ uploadState: 'complete' })
    .where(eq(mediaObjects.id, mediaId));

  return c.json({ ok: true });
});

// ── Get download URL ─────────────────────────────────────────────────────

mediaRouter.get('/v1/media/:id/download-url', async (c) => {
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
    ResponseContentDisposition: `inline; filename="${media.filename}"`,
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
