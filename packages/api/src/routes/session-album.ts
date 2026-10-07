import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  albumMediaListResponseSchema,
  albumUploadIntentRequestSchema,
  albumUploadIntentResponseSchema,
  spaceBackupSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  completeAlbumUploadProgram,
  createAlbumUploadIntentProgram,
  deleteAlbumMediaProgram,
  getAlbumBackupProgram,
  listAlbumMediaProgram,
  putAlbumBackupProgram,
  serveAlbumObjectProgram,
} from '../domains/album';

/**
 * Album routes (worker) — the E2EE shared photo library:
 * - POST   /v1/spaces/current/album/media          → presigned direct PUT,
 * - POST   /v1/spaces/current/album/media/:id/complete → head-verify size +
 *   guarded pending→complete,
 * - GET    /v1/spaces/current/album/media          → metadata list (no bytes),
 * - GET    /v1/spaces/current/album/media/:id/object → sealed ciphertext,
 * - DELETE /v1/spaces/current/album/media/:id      → soft delete (shared),
 * - GET/PUT /v1/spaces/current/album/backup        → space key envelopes.
 *
 * Every route is authenticated and membership-gated by the active space. The
 * server never reads the sealed bytes or the wrapped key.
 */

const albumMediaIdParamSchema = z.object({ id: z.string().uuid() });

export function albumRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitMedia = makeRateLimitMiddleware(run, 'MEDIA');
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  router.post(
    '/v1/spaces/current/album/media',
    requireAuth,
    rateLimitMedia,
    zValidator('json', albumUploadIntentRequestSchema),
    async (c) => {
      const result = await run(
        createAlbumUploadIntentProgram(c.var.userId, c.req.valid('json'))
      );
      return c.json(albumUploadIntentResponseSchema.parse(result), 201);
    }
  );

  router.post(
    '/v1/spaces/current/album/media/:id/complete',
    requireAuth,
    rateLimitMedia,
    zValidator('param', albumMediaIdParamSchema),
    async (c) => {
      const result = await run(
        completeAlbumUploadProgram(c.var.userId, c.req.valid('param').id)
      );
      return c.json(result);
    }
  );

  router.get(
    '/v1/spaces/current/album/media',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listAlbumMediaProgram(c.var.userId));
      return c.json(albumMediaListResponseSchema.parse(result));
    }
  );

  router.get(
    '/v1/spaces/current/album/media/:id/object',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', albumMediaIdParamSchema),
    async (c) => {
      const output = await run(
        serveAlbumObjectProgram(c.var.userId, c.req.valid('param').id)
      );
      return new Response(output.body as unknown as BodyInit, {
        status: output.status,
        headers: output.headers,
      });
    }
  );

  router.delete(
    '/v1/spaces/current/album/media/:id',
    requireAuth,
    rateLimitMedia,
    zValidator('param', albumMediaIdParamSchema),
    async (c) => {
      const result = await run(
        deleteAlbumMediaProgram(c.var.userId, c.req.valid('param').id)
      );
      return c.json(result);
    }
  );

  router.get(
    '/v1/spaces/current/album/backup',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(getAlbumBackupProgram(c.var.userId));
      return c.json(spaceBackupSchema.parse(result));
    }
  );

  router.put(
    '/v1/spaces/current/album/backup',
    requireAuth,
    rateLimitMedia,
    zValidator('json', spaceBackupSchema),
    async (c) => {
      const result = await run(putAlbumBackupProgram(c.var.userId, c.req.valid('json')));
      return c.json(spaceBackupSchema.parse(result));
    }
  );

  return router;
}
