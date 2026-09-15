import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  mediaObjectServeQuerySchema,
  mediaUploadIntentRequestSchema,
  mediaUploadIntentResponseSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  completeUploadProgram,
  createUploadIntentProgram,
  serveMediaProgram,
  type MediaVariantName,
} from '../domains/media';

/**
 * Media routes (worker) — the private R2 pipeline:
 * - POST /v1/media/upload-url  → presigned direct PUT (never stored),
 * - POST /v1/media/:id/complete → head-verify + guarded state transition +
 *   sanitize enqueue (all off the serve path),
 * - GET/HEAD /v1/media/:id/object?variant=… → stable serve URL with range
 *   support (audio) and membership gating. Durable signed URLs never exist.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/media.ts` — this
 * is the Cloudflare worker's route set.
 */

const mediaIdParamSchema = z.object({ id: z.string().uuid() });

/** Shared response builder for GET + HEAD serve (range-capable). */
function buildServeResponse(
  run: RunProgram,
  userId: string,
  id: string,
  variant: MediaVariantName | undefined,
  rangeHeader: string | null
): Promise<Response> {
  return run(serveMediaProgram(userId, id, variant ?? 'display', rangeHeader)).then(
    (output) =>
      new Response(output.body as unknown as BodyInit, {
        status: output.status,
        headers: output.headers,
      })
  );
}

export function mediaRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitMedia = makeRateLimitMiddleware(run, 'MEDIA');
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  router.post(
    '/v1/media/upload-url',
    requireAuth,
    rateLimitMedia,
    zValidator('json', mediaUploadIntentRequestSchema),
    async (c) => {
      const result = await run(createUploadIntentProgram(c.var.userId, c.req.valid('json')));
      return c.json(mediaUploadIntentResponseSchema.parse(result), 201);
    }
  );

  router.post(
    '/v1/media/:id/complete',
    requireAuth,
    rateLimitMedia,
    zValidator('param', mediaIdParamSchema),
    async (c) => {
      const result = await run(completeUploadProgram(c.var.userId, c.req.valid('param').id));
      return c.json(result);
    }
  );

  router.get(
    '/v1/media/:id/object',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', mediaIdParamSchema),
    zValidator('query', mediaObjectServeQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const { variant } = c.req.valid('query');
      return buildServeResponse(run, c.var.userId, id, variant, c.req.header('range') ?? null);
    }
  ); // HEAD is served automatically by the GET route (Hono strips the body).

  return router;
}
