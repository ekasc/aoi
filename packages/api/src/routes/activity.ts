import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, gte, lt, desc } from 'drizzle-orm';
import type { SpaceActivityResponse } from '@aoi/shared';
import { db } from '../db/index.js';
import { spaceActivity, spaceMembers, users } from '../db/schema.js';
import { activityRowToApi } from '../lib/db.js';

const activityRouter = new Hono();

// ── Activity retention / limits ───────────────────────────────────────────
// The feed is provenance, not history: never older than 7 days, capped.

const ACTIVITY_MAX_AGE_DAYS = 7;
const ACTIVITY_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── List recent space activity ────────────────────────────────────────────

const listActivityQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

activityRouter.get(
  '/v1/spaces/current/activity',
  zValidator('query', listActivityQuerySchema),
  async (c) => {
    const userId = c.var.userId;
    const { since } = c.req.valid('query');

    // Same membership check as sibling /v1/spaces/current routes:
    // no active space → empty feed.
    const membership = await db
      .select()
      .from(spaceMembers)
      .where(
        and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
      )
      .limit(1);

    if (membership.length === 0) {
      const empty: SpaceActivityResponse = { activity: [] };
      return c.json(empty);
    }

    // Window: at most 7 days back, optionally narrowed by `since`.
    const oldestAllowed = new Date(Date.now() - ACTIVITY_MAX_AGE_DAYS * MS_PER_DAY);
    const requestedSince = since ? new Date(since) : null;
    const windowStart =
      requestedSince && requestedSince.getTime() > oldestAllowed.getTime()
        ? requestedSince
        : oldestAllowed;

    const rows = await db
      .select({
        id: spaceActivity.id,
        kind: spaceActivity.kind,
        occurredAt: spaceActivity.occurredAt,
        actorName: users.displayName,
      })
      .from(spaceActivity)
      .innerJoin(users, eq(spaceActivity.actorUserId, users.id))
      .where(
        and(
          eq(spaceActivity.spaceId, membership[0].spaceId),
          gte(spaceActivity.occurredAt, windowStart)
        )
      )
      .orderBy(desc(spaceActivity.occurredAt), desc(spaceActivity.id))
      .limit(ACTIVITY_LIMIT);

    // Defensive clamp: never return rows outside the retention window.
    const activity = rows
      .filter((row) => row.occurredAt.getTime() >= windowStart.getTime())
      .map(activityRowToApi);

    // Inline retention purge: the feed never shows rows older than 7 days,
    // so prune them cheaply on read. Best-effort — never fail the request.
    try {
      await db
        .delete(spaceActivity)
        .where(
          and(
            eq(spaceActivity.spaceId, membership[0].spaceId),
            lt(spaceActivity.occurredAt, oldestAllowed)
          )
        );
    } catch {
      // Purge is housekeeping only; the read above already succeeded.
    }

    const response: SpaceActivityResponse = { activity };
    return c.json(response);
  }
);

export { activityRouter };
