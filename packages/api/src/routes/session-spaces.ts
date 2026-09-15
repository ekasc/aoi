import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  createSpaceRequestSchema,
  joinSpaceRequestSchema,
  spaceSchema,
  updateSpaceRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createSpaceProgram,
  getCurrentSpaceProgram,
  joinSpaceProgram,
  leaveSpaceProgram,
  regenerateInviteProgram,
  updateSpaceProgram,
} from '../domains/spaces';

/**
 * Spaces routes (worker) — thin transport over the Effect space programs.
 * Auth is applied per-router (NOT globally): these are the only protected
 * routes in the worker shell today, and applying `use('/v1/*')` globally
 * would also protect the public `/v1/auth/*` adapters (a latent bug in the
 * legacy app).
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/spaces.ts` —
 * this is the Cloudflare worker's route set.
 */

export function spacesRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  // GENERAL tier, matching every other protected router (the legacy app
  // applied a global 100 req/min limit to all /v1/* — the worker enforces
  // per-router; the invite-join endpoint especially needs the cap against
  // code brute-forcing).
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // Auth is applied per-route (a sub-app `use('*')` would run for every path
  // through the `/` mount, 401ing unrelated unknown routes).

  // ── Get current space ────────────────────────────────────────────────
  router.get('/v1/spaces/current', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(getCurrentSpaceProgram(c.var.userId));
    if (!result.space) {
      return c.json({ space: null, inviteCode: null });
    }
    return c.json({ space: spaceSchema.parse(result.space), inviteCode: result.space.inviteCode });
  });

  // ── Create space ─────────────────────────────────────────────────────
  router.post(
    '/v1/spaces',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createSpaceRequestSchema),
    async (c) => {
      const input = c.req.valid('json');
      const result = await run(createSpaceProgram(c.var.userId, input));
      return c.json(
        { space: spaceSchema.parse(result.space), inviteCode: result.space.inviteCode },
        201
      );
    }
  );

  // ── Join space (redeem invite) ───────────────────────────────────────
  router.post(
    '/v1/spaces/join',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', joinSpaceRequestSchema),
    async (c) => {
      const { inviteCode } = c.req.valid('json');
      const result = await run(joinSpaceProgram(c.var.userId, inviteCode));
      return c.json({ space: spaceSchema.parse(result.space) });
    }
  );

  // ── Leave space ──────────────────────────────────────────────────────
  router.post('/v1/spaces/leave', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(leaveSpaceProgram(c.var.userId));
    return c.json(result);
  });

  // ── Regenerate invite (creator only) ─────────────────────────────────
  router.post('/v1/spaces/current/invite', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(regenerateInviteProgram(c.var.userId));
    return c.json(result, 201);
  });

  // ── Update space (creator only) ──────────────────────────────────────
  router.patch(
    '/v1/spaces/current',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', updateSpaceRequestSchema),
    async (c) => {
      const input = c.req.valid('json');
      const result = await run(updateSpaceProgram(c.var.userId, input));
      return c.json({ space: spaceSchema.parse(result.space) });
    }
  );

  return router;
}
