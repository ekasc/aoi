import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import {
  PUSH_TOKEN_PLATFORMS,
  isExpoPushToken,
} from '@aoi/shared';
import { db } from '../db/index.js';
import { pushTokens } from '../db/schema.js';

const pushRouter = new Hono();

// ── Register (upsert) a device push token ────────────────────────────────
// Re-registering the same token refreshes it; a token re-registered by a
// different user is reassigned to them (tokens are device-scoped). The
// single upsert statement makes both cases atomic — no read-then-write race.

const registerPushTokenSchema = z.object({
  expoPushToken: z
    .string()
    .refine(isExpoPushToken, { message: 'Invalid push token format' }),
  platform: z.enum(PUSH_TOKEN_PLATFORMS).default('unknown'),
});

pushRouter.post(
  '/v1/push/tokens',
  zValidator('json', registerPushTokenSchema),
  async (c) => {
    const userId = c.var.userId;
    const input = c.req.valid('json');

    const [token] = await db
      .insert(pushTokens)
      .values({
        userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
      })
      .onConflictDoUpdate({
        target: pushTokens.expoPushToken,
        set: {
          userId,
          platform: input.platform,
          lastSeenAt: new Date(),
        },
      })
      .returning();

    // Minimal echo — the token itself never comes back down the wire.
    return c.json({ id: token.id, platform: token.platform });
  }
);

// ── Unregister a device push token (e.g. sign-out) ───────────────────────
// Scoped to the caller: you can only remove your own registration. Responses
// are identical whether or not the token existed — no existence leaks.

const unregisterPushTokenSchema = z.object({
  expoPushToken: z
    .string()
    .refine(isExpoPushToken, { message: 'Invalid push token format' }),
});

pushRouter.delete(
  '/v1/push/tokens',
  zValidator('json', unregisterPushTokenSchema),
  async (c) => {
    const userId = c.var.userId;
    const input = c.req.valid('json');

    await db
      .delete(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, userId),
          eq(pushTokens.expoPushToken, input.expoPushToken)
        )
      );

    return c.json({ ok: true });
  }
);

export { pushRouter };
