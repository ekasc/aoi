import { Hono } from 'hono';
import { z } from 'zod';

import type { RunProgram } from '../create-app';
import { mintE2ESessionProgram } from '../domains/e2e-auth';

/**
 * E2E-only auth bootstrap (see domains/e2e-auth.ts for the trust story).
 *
 * Public by necessity — the caller has no session yet — and gated by the
 * per-run secret inside the program. Registered only by the isolated E2E
 * server; the production app never imports or mounts this router.
 */
export function e2eAuthRouter(run: RunProgram): Hono {
  const router = new Hono();

  router.post('/v1/auth/e2e/session', async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const parsed = z
      .object({ email: z.string().email(), secret: z.string().min(1) })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } }, 400);
    }
    const result = await run(
      mintE2ESessionProgram(parsed.data.email, parsed.data.secret)
    );
    return c.json(result, 201);
  });

  return router;
}
