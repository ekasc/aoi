import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  updateUserPreferencesRequestSchema,
  userPreferencesSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { getPreferencesProgram, updatePreferencesProgram } from '../domains/preferences';

/**
 * Preferences routes (worker) — thin transport over the Effect preference
 * programs.
 *
 * NOTE: the legacy Node/Postgres app keeps its own
 * `routes/preferences.ts` — this is the Cloudflare worker's route set.
 */

export function preferencesRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── Get preferences (defaults when unset) ─────────────────────────────
  router.get('/v1/users/me/preferences', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(getPreferencesProgram(c.var.userId));
    return c.json(userPreferencesSchema.parse(result));
  });

  // ── Update preferences (idempotent upsert) ────────────────────────────
  router.patch(
    '/v1/users/me/preferences',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', updateUserPreferencesRequestSchema),
    async (c) => {
      const result = await run(updatePreferencesProgram(c.var.userId, c.req.valid('json')));
      return c.json(userPreferencesSchema.parse(result));
    }
  );

  return router;
}
