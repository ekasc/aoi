import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  createImportedMilestoneRequestSchema,
  importedMilestoneSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createMilestoneProgram,
  listMilestonesProgram,
} from '../domains/milestones';

/**
 * Milestones routes (worker) — thin transport over the Effect milestone
 * programs.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/milestones.ts` —
 * this is the Cloudflare worker's route set.
 */

export function milestonesRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── List imported milestones ──────────────────────────────────────────
  router.get(
    '/v1/spaces/current/imported-milestones',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listMilestonesProgram(c.var.userId));
      return c.json(result.map((milestone) => importedMilestoneSchema.parse(milestone)));
    }
  );

  // ── Create imported milestone ─────────────────────────────────────────
  router.post(
    '/v1/spaces/current/imported-milestones',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createImportedMilestoneRequestSchema),
    async (c) => {
      const result = await run(createMilestoneProgram(c.var.userId, c.req.valid('json')));
      return c.json(importedMilestoneSchema.parse(result), 201);
    }
  );

  return router;
}
