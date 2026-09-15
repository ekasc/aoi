import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  createSomedayItemRequestSchema,
  somedayItemSchema,
  somedayListResponseSchema,
  updateSomedayItemRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createSomedayProgram,
  listSomedayProgram,
  updateSomedayProgram,
} from '../domains/someday';

/**
 * Someday routes (worker) — thin transport over the Effect someday
 * programs. Canonical ordering and the membership gate live in the domain.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/someday.ts` —
 * this is the Cloudflare worker's route set.
 */

export function somedayRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── List items ────────────────────────────────────────────────────────
  router.get(
    '/v1/spaces/current/someday',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listSomedayProgram(c.var.userId));
      return c.json(somedayListResponseSchema.parse({ items: result }));
    }
  );

  // ── Create item ───────────────────────────────────────────────────────
  router.post(
    '/v1/spaces/current/someday',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createSomedayItemRequestSchema),
    async (c) => {
      const result = await run(createSomedayProgram(c.var.userId, c.req.valid('json')));
      return c.json(somedayItemSchema.parse(result), 201);
    }
  );

  // ── Update item (check-off, undo, edits) ──────────────────────────────
  router.patch(
    '/v1/someday/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', updateSomedayItemRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(updateSomedayProgram(c.var.userId, id, c.req.valid('json')));
      return c.json(somedayItemSchema.parse(result));
    }
  );

  return router;
}
