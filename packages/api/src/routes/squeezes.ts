import { Hono } from 'hono';
import { badRequest } from '../lib/errors.js';
import { getActiveSpaceId } from '../lib/space.js';
import { notifyPartnerInSpace } from '../lib/push.js';
import { rateLimit } from '../middleware/rate-limit.js';

const squeezesRouter = new Hono();

// ── Send a squeeze ───────────────────────────────────────────────────────
// A squeeze is wordless: it is delivered as a fire-and-forget push to the
// partner and nothing is stored. No row means nothing sensitive to protect,
// purge, or leak — and a missed delivery simply stays a quiet thought.
// (Seam: an offline partner does not receive it; there is no replay.)

// A squeeze should never become a firehose — gentle cap per sender. The key
// is prefixed: the rate-limit store is shared across limiter instances, and
// the global /v1 limiter already keys on the bare user id.
const squeezeRateLimit = rateLimit({
  max: 10,
  windowSec: 60,
  keyFn: (c) => `squeeze:${c.var.userId ?? 'unknown'}`,
});

squeezesRouter.post('/v1/squeezes', squeezeRateLimit, async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    throw badRequest('You must have an active space to send a squeeze');
  }

  await notifyPartnerInSpace(spaceId, userId, 'squeeze');

  return c.json({ ok: true }, 202);
});

export { squeezesRouter };
