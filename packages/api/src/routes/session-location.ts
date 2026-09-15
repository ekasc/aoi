import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  currentLocationResponseSchema,
  locationConsentRequestSchema,
  locationConsentResponseSchema,
  locationShareRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  getLocationProgram,
  requestLocationProgram,
  shareLocationProgram,
  stopSharingProgram,
  updateConsentProgram,
} from '../domains/location';

/**
 * Location routes (worker) — thin transport over the Effect location
 * programs. Consent gates, freshness, and one-time-grant consumption live in
 * the domain layer. The request route uses its own rate-limit tier.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/location.ts` —
 * this is the Cloudflare worker's route set.
 */

export function locationRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');
  const rateLimitLocationRequest = makeRateLimitMiddleware(run, 'LOCATION_REQUEST');

  // ── Get the partner's current share (null when nothing qualifies) ──────
  router.get(
    '/v1/spaces/current/location',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(getLocationProgram(c.var.userId));
      return c.json(currentLocationResponseSchema.parse(result));
    }
  );

  // ── Post share (upsert the caller's latest position) ──────────────────
  router.post(
    '/v1/spaces/current/location/share',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', locationShareRequestSchema),
    async (c) => {
      const result = await run(shareLocationProgram(c.var.userId, c.req.valid('json')));
      return c.json(result, 201);
    }
  );

  // ── Delete share (stop) ───────────────────────────────────────────────
  router.delete('/v1/spaces/current/location/share', requireAuth, rateLimitGeneral, async (c) => {
    const result = await run(stopSharingProgram(c.var.userId));
    return c.json(result);
  });

  // ── Post consent (opt in / out) ───────────────────────────────────────
  router.post(
    '/v1/spaces/current/location/consent',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', locationConsentRequestSchema),
    async (c) => {
      const result = await run(updateConsentProgram(c.var.userId, c.req.valid('json')));
      return c.json(locationConsentResponseSchema.parse(result));
    }
  );

  // ── Post request (ask the partner for a one-time share) ───────────────
  router.post(
    '/v1/spaces/current/location/request',
    requireAuth,
    rateLimitLocationRequest,
    async (c) => {
      const result = await run(requestLocationProgram(c.var.userId));
      return c.json(result, 202);
    }
  );

  return router;
}
