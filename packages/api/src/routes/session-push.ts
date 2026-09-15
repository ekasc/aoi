import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  registerPushTokenRequestSchema,
  registerPushTokenResponseSchema,
  unregisterPushTokenRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { registerPushTokenProgram, unregisterPushTokenProgram } from '../domains/push';

/**
 * Push token registry (worker) — device-scoped upsert with reassignment,
 * per-user cap, and caller-scoped unregister. Responses are identical
 * whether or not a token existed (no existence leaks).
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/push.ts` — this
 * is the Cloudflare worker's route set.
 */

export function pushRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  router.post(
    '/v1/push/tokens',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', registerPushTokenRequestSchema),
    async (c) => {
      const result = await run(registerPushTokenProgram(c.var.userId, c.req.valid('json')));
      return c.json(registerPushTokenResponseSchema.parse(result));
    }
  );

  router.delete(
    '/v1/push/tokens',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', unregisterPushTokenRequestSchema),
    async (c) => {
      const result = await run(unregisterPushTokenProgram(c.var.userId, c.req.valid('json').expoPushToken));
      return c.json(result);
    }
  );

  return router;
}
