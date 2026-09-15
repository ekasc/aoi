import { Hono } from 'hono';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { sendSqueezeProgram } from '../domains/squeezes';

/**
 * Squeezes routes (worker) — thin transport over the squeeze program.
 * Uses its own rate-limit tier (a squeeze should never become a firehose).
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/squeezes.ts` —
 * this is the Cloudflare worker's route set.
 */

export function squeezesRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitSqueeze = makeRateLimitMiddleware(run, 'SQUEEZE');

  // ── Send a squeeze (wordless, fire-and-forget push) ───────────────────
  router.post('/v1/squeezes', requireAuth, rateLimitSqueeze, async (c) => {
    const result = await run(sendSqueezeProgram(c.var.userId));
    return c.json(result, 202);
  });

  return router;
}
