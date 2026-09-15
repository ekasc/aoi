import { Hono } from 'hono';

import { spacePlusResponseSchema } from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { getSpacePlusProgram, processRevenueCatWebhook } from '../domains/plus';

/**
 * Plus routes (worker).
 *
 * - POST /v1/billing/revenuecat/webhook is PUBLIC (no session middleware):
 *   it authenticates via the dashboard-configured webhook secret inside the
 *   domain program instead. No rate-limit tier: the delivery is
 *   secret-authenticated and RevenueCat retries failures on its own
 *   schedule; an anonymous shared bucket would let anyone exhaust the tier
 *   and block legitimate provider retries.
 * - GET /v1/spaces/current/plus is session-authenticated and scoped to the
 *   caller's own active Space — a non-member can never read another Space.
 */
export function plusRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  router.post('/v1/billing/revenuecat/webhook', async (c) => {
    const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const result = await run(processRevenueCatWebhook(authHeader, body));
    return c.json(result);
  });

  router.get('/v1/spaces/current/plus', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(getSpacePlusProgram(c.var.userId));
    return c.json(spacePlusResponseSchema.parse(result));
  });

  return router;
}
