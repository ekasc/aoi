import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  letterSchema,
  letterListResponseSchema,
  sealLetterRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  listLettersProgram,
  openLetterProgram,
  sealLetterProgram,
} from '../domains/letters';

/**
 * Letters routes (worker) — thin transport over the Effect letter programs.
 * The body lock (unopened bodies never leave the server) and the guarded
 * one-way open transition live in the domain layer.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/letters.ts` —
 * this is the Cloudflare worker's route set.
 */

export function lettersRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── Seal a letter ─────────────────────────────────────────────────────
  router.post(
    '/v1/spaces/current/letters',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', sealLetterRequestSchema),
    async (c) => {
      const result = await run(sealLetterProgram(c.var.userId, c.req.valid('json')));
      return c.json(letterSchema.parse(result), 201);
    }
  );

  // ── List the shelf ────────────────────────────────────────────────────
  router.get(
    '/v1/spaces/current/letters',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listLettersProgram(c.var.userId));
      return c.json(letterListResponseSchema.parse({ letters: result }));
    }
  );

  // ── Open a letter (guarded one-way transition) ────────────────────────
  router.post(
    '/v1/letters/:id/open',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(openLetterProgram(c.var.userId, id));
      return c.json(letterSchema.parse(result));
    }
  );

  return router;
}
