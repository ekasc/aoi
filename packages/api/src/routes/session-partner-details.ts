import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPartnerDetailRequestSchema, partnerDetailSchema, partnerDetailListResponseSchema } from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { createPartnerDetailProgram, deletePartnerDetailProgram, listPartnerDetailsProgram } from '../domains/partner-details';

export function partnerDetailsRouter(run: RunProgram): Hono {
  const router = new Hono();
  const auth = makeAuthMiddleware(run);
  const limit = makeRateLimitMiddleware(run, 'GENERAL');
  router.get('/v1/users/me/partner-details', auth, limit, async (c) => {
    const details = await run(listPartnerDetailsProgram(c.var.userId));
    return c.json(partnerDetailListResponseSchema.parse({ details }));
  });
  router.post('/v1/users/me/partner-details', auth, limit, zValidator('json', createPartnerDetailRequestSchema), async (c) => {
    const result = await run(createPartnerDetailProgram(c.var.userId, c.req.valid('json')));
    return c.json(partnerDetailSchema.parse(result), 201);
  });
  router.delete('/v1/users/me/partner-details/:id', auth, limit, zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
    return c.json(await run(deletePartnerDetailProgram(c.var.userId, c.req.valid('param').id)));
  });
  return router;
}
