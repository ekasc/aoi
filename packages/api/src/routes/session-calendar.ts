import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  calendarEventSchema,
  createCalendarEventRequestSchema,
  updateCalendarEventRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createEventProgram,
  deleteEventProgram,
  getEventProgram,
  listEventsProgram,
  updateEventProgram,
} from '../domains/calendar';

/**
 * Calendar routes (worker) — thin transport over the Effect calendar
 * programs. Authorization (active membership + creator-only mutations) lives
 * in the domain layer; weekly recurrence expansion is server-side.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/calendar.ts` —
 * this is the Cloudflare worker's route set.
 */

export function calendarRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');

  const eventIdParamSchema = z.object({ id: z.string().uuid() });

  // ── List events by date range ─────────────────────────────────────────
  const listEventsQuerySchema = z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  });

  router.get(
    '/v1/spaces/current/calendar/events',
    requireAuth,
    rateLimitGeneral,
    zValidator('query', listEventsQuerySchema),
    async (c) => {
      const result = await run(listEventsProgram(c.var.userId, c.req.valid('query')));
      return c.json(result.map((event) => calendarEventSchema.parse(event)));
    }
  );

  // ── Get single event ──────────────────────────────────────────────────
  router.get(
    '/v1/calendar/events/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', eventIdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(getEventProgram(c.var.userId, id));
      return c.json(calendarEventSchema.parse(result));
    }
  );

  // ── Create event ──────────────────────────────────────────────────────
  router.post(
    '/v1/spaces/current/calendar/events',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createCalendarEventRequestSchema),
    async (c) => {
      const result = await run(createEventProgram(c.var.userId, c.req.valid('json')));
      return c.json(calendarEventSchema.parse(result), 201);
    }
  );

  // ── Update event (creator only, this instance only) ───────────────────
  router.patch(
    '/v1/calendar/events/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', eventIdParamSchema),
    zValidator('json', updateCalendarEventRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(updateEventProgram(c.var.userId, id, c.req.valid('json')));
      return c.json(calendarEventSchema.parse(result));
    }
  );

  // ── Delete event (soft delete, creator only) ──────────────────────────
  router.delete(
    '/v1/calendar/events/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', eventIdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(deleteEventProgram(c.var.userId, id));
      return c.json(result);
    }
  );

  return router;
}
