import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createMomentResponseRequestSchema, momentResponseSchema, momentResponseListResponseSchema, momentResponsePageQuerySchema } from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { createResponseProgram, listResponsesProgram, listSpaceResponsesProgram } from '../domains/responses';

export function responsesRouter(run: RunProgram): Hono {
  const router = new Hono();
  const auth = makeAuthMiddleware(run);
  const limit = makeRateLimitMiddleware(run, 'GENERAL');
  const param = zValidator('param', z.object({ id: z.string().uuid() }));
  router.get('/v1/spaces/current/responses', auth, limit, zValidator('query', momentResponsePageQuerySchema), async (c) => {
    return c.json(momentResponseListResponseSchema.parse(await run(listSpaceResponsesProgram(c.var.userId, c.req.valid('query')))));
  });
  router.get('/v1/moments/:id/responses', auth, limit, param, async (c) => {
    const responses = await run(listResponsesProgram(c.var.userId, c.req.valid('param').id));
    return c.json(momentResponseListResponseSchema.parse({ responses }));
  });
  router.post('/v1/moments/:id/responses', auth, limit, param, zValidator('json', createMomentResponseRequestSchema), async (c) => {
    const result = await run(createResponseProgram(c.var.userId, c.req.valid('param').id, c.req.valid('json')));
    return c.json(momentResponseSchema.parse(result), 201);
  });
  return router;
}
