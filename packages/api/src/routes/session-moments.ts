import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  bucketSummaryQuerySchema,
  bucketSummaryResponseSchema,
  createMomentRequestSchema,
  listMomentsQuerySchema,
  markMomentsReadRequestSchema,
  markMomentsReadResponseSchema,
  momentIdParamSchema,
  momentSchema,
  momentListResponseSchema,
  spaceActivityResponseSchema,
  timelineQuerySchema,
  timelineResponseSchema,
  updateMomentRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createMomentProgram,
  deleteMomentProgram,
  listBucketSummaryProgram,
  listMomentsProgram,
  listTimelineProgram,
  markMomentsReadProgram,
  updateMomentProgram,
} from '../domains/moments';
import { listActivityProgram } from '../domains/activity';

/**
 * Moments + activity routes (worker) — thin transport over the Effect
 * programs. Authorization is per-request (ownership + active membership,
 * enforced in the domain); keyset pagination, idempotent create, tombstones
 * and the activity feed all live in the domain layer.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/moments.ts` and
 * `routes/activity.ts` — this is the Cloudflare worker's route set.
 */

export function momentsRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── List moments (keyset pagination) ─────────────────────────────────
  router.get(
    '/v1/spaces/current/moments',
    requireAuth,
    rateLimitGeneral,
    zValidator('query', listMomentsQuerySchema),
    async (c) => {
      const result = await run(listMomentsProgram(c.var.userId, c.req.valid('query')));
      return c.json(momentListResponseSchema.parse(result));
    }
  );

  // ── Bidirectional chronological timeline (synced read state) ─────
  // Separate from the legacy newest-first list so old clients never regress:
  // ascending (occurredAt, id), latest at the bottom, older above.
  router.get(
    '/v1/spaces/current/moments/timeline',
    requireAuth,
    rateLimitGeneral,
    zValidator('query', timelineQuerySchema),
    async (c) => {
      const result = await run(listTimelineProgram(c.var.userId, c.req.valid('query')));
      return c.json(timelineResponseSchema.parse(result));
    }
  );

  // ── Mark moments read (idempotent, visible-only, no notification) ───
  router.post(
    '/v1/spaces/current/moments/read',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', markMomentsReadRequestSchema),
    async (c) => {
      const result = await run(markMomentsReadProgram(c.var.userId, c.req.valid('json')));
      return c.json(markMomentsReadResponseSchema.parse(result));
    }
  );

  // ── Chapter-discovery bucket summary (bounded, no bodies) ────────
  router.get(
    '/v1/spaces/current/moments/summary',
    requireAuth,
    rateLimitGeneral,
    zValidator('query', bucketSummaryQuerySchema),
    async (c) => {
      const result = await run(listBucketSummaryProgram(c.var.userId, c.req.valid('query')));
      return c.json(bucketSummaryResponseSchema.parse(result));
    }
  );

  // ── Create moment (idempotent via clientId) ──────────────────────────
  router.post(
    '/v1/spaces/current/moments',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createMomentRequestSchema),
    async (c) => {
      const result = await run(createMomentProgram(c.var.userId, c.req.valid('json')));
      // A clientId replay returns the original row as 200 (idempotent
      // no-op); a fresh create is 201.
      return c.json(momentSchema.parse(result.moment), result.created ? 201 : 200);
    }
  );

  // ── Update own moment ────────────────────────────────────────────────
  router.patch(
    '/v1/moments/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', momentIdParamSchema),
    zValidator('json', updateMomentRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(updateMomentProgram(c.var.userId, id, c.req.valid('json')));
      return c.json(momentSchema.parse(result));
    }
  );

  // ── Delete own moment (tombstone) ────────────────────────────────────
  router.delete(
    '/v1/moments/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', momentIdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(deleteMomentProgram(c.var.userId, id));
      return c.json(result);
    }
  );

  // ── Activity feed (7-day provenance window) ──────────────────────────
  const listActivityQuerySchema = z.object({
    since: z.string().datetime({ offset: true }).optional(),
  });

  router.get(
    '/v1/spaces/current/activity',
    requireAuth,
    rateLimitGeneral,
    zValidator('query', listActivityQuerySchema),
    async (c) => {
      const result = await run(listActivityProgram(c.var.userId, c.req.valid('query')));
      return c.json(spaceActivityResponseSchema.parse(result));
    }
  );

  return router;
}
