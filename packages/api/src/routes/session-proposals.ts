import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  eventProposalSchema,
  proposalListResponseSchema,
  createProposalRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  acceptProposalProgram,
  createProposalProgram,
  declineProposalProgram,
  listProposalsProgram,
} from '../domains/proposals';

/**
 * Proposals routes (worker) — thin transport over the Effect proposal
 * programs. Accept/decline guards (partner-only, pending-only) and the
 * atomic accept→calendar-event batch live in the domain layer.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/proposals.ts` —
 * this is the Cloudflare worker's route set.
 */

export function proposalsRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  const proposalIdParamSchema = z.object({ id: z.string().uuid() });

  // ── Create a proposal ─────────────────────────────────────────────────
  router.post(
    '/v1/spaces/current/proposals',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createProposalRequestSchema),
    async (c) => {
      const result = await run(createProposalProgram(c.var.userId, c.req.valid('json')));
      return c.json(eventProposalSchema.parse(result), 201);
    }
  );

  // ── List proposals ────────────────────────────────────────────────────
  router.get(
    '/v1/spaces/current/proposals',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listProposalsProgram(c.var.userId));
      return c.json(proposalListResponseSchema.parse({ proposals: result }));
    }
  );

  // ── Accept (partner-only; copies into a calendar event atomically) ────
  router.post(
    '/v1/proposals/:id/accept',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', proposalIdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(acceptProposalProgram(c.var.userId, id));
      return c.json(eventProposalSchema.parse(result));
    }
  );

  // ── Decline (partner-only) ────────────────────────────────────────────
  router.post(
    '/v1/proposals/:id/decline',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', proposalIdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(declineProposalProgram(c.var.userId, id));
      return c.json(eventProposalSchema.parse(result));
    }
  );

  return router;
}
