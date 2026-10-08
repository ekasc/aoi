import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  PROTOCOL_MAX_COUNTER,
  PROTOCOL_MAX_ID_LENGTH,
  wireAlbumDeviceRecordResponseSchema,
  wireAlbumDeviceTombstoneResponseSchema,
  wireAlbumMediaManifestResponseSchema,
  wireAlbumMediaProtocolSchema,
  wireAlbumMediaTombstoneResponseSchema,
  wireAlbumProtocolSnapshotSchema,
  wireAlbumRecoveryEnvelopeResponseSchema,
  wireAlbumSpaceKeyEnvelopeResponseSchema,
  wireAlbumTrustAnchorResponseSchema,
  wireDeviceClaimRequestSchema,
  wireDeviceClaimResponseSchema,
  wireDeviceRecordSchema,
  wireDeviceTombstoneSchema,
  wireMediaManifestSchema,
  wireMediaTombstoneSchema,
  wireRecoveryEnvelopeSchema,
  wireSpaceKeyEnvelopeSchema,
  wireSpaceTrustAnchorSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  getAlbumMediaProtocolProgram,
  getAlbumProtocolSnapshotProgram,
  postAlbumDeviceTombstoneProgram,
  postAlbumMediaTombstoneProgram,
  putAlbumDeviceClaimProgram,
  putAlbumDeviceRecordProgram,
  putAlbumMediaManifestProgram,
  putAlbumRecoveryEnvelopeProgram,
  putAlbumSpaceKeyEnvelopeProgram,
  putAlbumTrustAnchorProgram,
} from '../domains/album-protocol';

/**
 * The protocol's routes.
 *
 * Per-object writes and one snapshot read. Writes are narrow because each one
 * has a different owner: a device record belongs to the device's own account, an
 * envelope belongs to the authoriser's, and the anchor belongs to the Space's
 * creator. A single read keeps startup from being a pile of round trips.
 *
 * Every route is authenticated and every payload is the canonical wire schema,
 * so nothing reaches the domain as loose JSON.
 *
 * The old `/album/backup` routes live in `session-album.ts` and are untouched.
 */

const deviceIdParamSchema = z.object({
  deviceId: z.string().min(1).max(PROTOCOL_MAX_ID_LENGTH),
});

const mediaIdParamSchema = z.object({
  mediaId: z.string().min(1).max(PROTOCOL_MAX_ID_LENGTH),
});

const generationParamSchema = z.object({
  generation: z.coerce.number().int().min(1).max(PROTOCOL_MAX_COUNTER),
});

export function albumProtocolRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimit = makeRateLimitMiddleware(run, 'GENERAL');

  router.get('/v1/spaces/current/album/protocol', requireAuth, rateLimit, async (c) => {
    const result = await run(getAlbumProtocolSnapshotProgram(c.var.userId));
    return c.json(wireAlbumProtocolSnapshotSchema.parse(result));
  });

  router.put(
    '/v1/spaces/current/album/protocol/anchor',
    requireAuth,
    rateLimit,
    zValidator('json', wireSpaceTrustAnchorSchema),
    async (c) => {
      const result = await run(putAlbumTrustAnchorProgram(c.var.userId, c.req.valid('json')));
      return c.json(wireAlbumTrustAnchorResponseSchema.parse({ anchor: result }), 201);
    }
  );

  router.post(
    '/v1/spaces/current/album/protocol/device-claims',
    requireAuth,
    rateLimit,
    zValidator('json', wireDeviceClaimRequestSchema),
    async (c) => {
      const result = await run(putAlbumDeviceClaimProgram(c.var.userId, c.req.valid('json')));
      return c.json(wireDeviceClaimResponseSchema.parse({ claim: result }), 201);
    }
  );

  router.put(
    '/v1/spaces/current/album/protocol/devices/:deviceId',
    requireAuth,
    rateLimit,
    zValidator('param', deviceIdParamSchema),
    zValidator('json', wireDeviceRecordSchema),
    async (c) => {
      const result = await run(
        putAlbumDeviceRecordProgram(c.var.userId, c.req.valid('param').deviceId, c.req.valid('json'))
      );
      return c.json(wireAlbumDeviceRecordResponseSchema.parse({ record: result }), 201);
    }
  );

  router.post(
    '/v1/spaces/current/album/protocol/device-tombstones',
    requireAuth,
    rateLimit,
    zValidator('json', wireDeviceTombstoneSchema),
    async (c) => {
      const result = await run(postAlbumDeviceTombstoneProgram(c.var.userId, c.req.valid('json')));
      return c.json(wireAlbumDeviceTombstoneResponseSchema.parse({ tombstone: result }), 201);
    }
  );

  router.put(
    '/v1/spaces/current/album/protocol/envelopes',
    requireAuth,
    rateLimit,
    zValidator('json', wireSpaceKeyEnvelopeSchema),
    async (c) => {
      const result = await run(putAlbumSpaceKeyEnvelopeProgram(c.var.userId, c.req.valid('json')));
      return c.json(wireAlbumSpaceKeyEnvelopeResponseSchema.parse({ envelope: result }), 201);
    }
  );

  router.put(
    '/v1/spaces/current/album/protocol/recovery-envelopes/:generation',
    requireAuth,
    rateLimit,
    zValidator('param', generationParamSchema),
    zValidator('json', wireRecoveryEnvelopeSchema),
    async (c) => {
      const result = await run(
        putAlbumRecoveryEnvelopeProgram(
          c.var.userId,
          c.req.valid('param').generation,
          c.req.valid('json')
        )
      );
      return c.json(wireAlbumRecoveryEnvelopeResponseSchema.parse({ recoveryEnvelope: result }), 201);
    }
  );

  router.get('/v1/spaces/current/album/protocol/media', requireAuth, rateLimit, async (c) => {
    const result = await run(getAlbumMediaProtocolProgram(c.var.userId));
    return c.json(wireAlbumMediaProtocolSchema.parse(result));
  });

  router.put(
    '/v1/spaces/current/album/protocol/media/:mediaId/manifest',
    requireAuth,
    rateLimit,
    zValidator('param', mediaIdParamSchema),
    zValidator('json', wireMediaManifestSchema),
    async (c) => {
      const result = await run(
        putAlbumMediaManifestProgram(
          c.var.userId,
          c.req.valid('param').mediaId,
          c.req.valid('json')
        )
      );
      return c.json(wireAlbumMediaManifestResponseSchema.parse({ manifest: result }), 201);
    }
  );

  router.post(
    '/v1/spaces/current/album/protocol/media-tombstones',
    requireAuth,
    rateLimit,
    zValidator('json', wireMediaTombstoneSchema),
    async (c) => {
      const result = await run(postAlbumMediaTombstoneProgram(c.var.userId, c.req.valid('json')));
      return c.json(wireAlbumMediaTombstoneResponseSchema.parse({ tombstone: result }), 201);
    }
  );

  return router;
}
