import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import {
  putWeeklyAnswerRequestSchema,
  weeklyQuestionResponseSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { getQuestionProgram, putAnswerProgram } from '../domains/question';

/**
 * Question routes (worker) — thin transport over the Effect question
 * programs. The reveal gate (both answers in before partner content is
 * served) lives in the domain layer.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/question.ts` —
 * this is the Cloudflare worker's route set.
 */

export function questionRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  // ── Get the current question + both answer states ─────────────────────
  router.get(
    '/v1/spaces/current/question',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(getQuestionProgram(c.var.userId));
      return c.json(weeklyQuestionResponseSchema.parse(result));
    }
  );

  // ── Upsert your own answer for this week ──────────────────────────────
  router.put(
    '/v1/spaces/current/question/answer',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', putWeeklyAnswerRequestSchema),
    async (c) => {
      const result = await run(putAnswerProgram(c.var.userId, c.req.valid('json')));
      return c.json(weeklyQuestionResponseSchema.parse(result));
    }
  );

  return router;
}
