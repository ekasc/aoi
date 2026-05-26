import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { importedMilestones, spaceMembers } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';

const milestonesRouter = new Hono();

async function getActiveSpaceId(userId: string): Promise<string | null> {
  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);
  return membership.length > 0 ? membership[0].spaceId : null;
}

// ── List imported milestones ─────────────────────────────────────────────

milestonesRouter.get('/v1/spaces/current/imported-milestones', async (c) => {
  const userId = c.var.userId;
  const spaceId = await getActiveSpaceId(userId);

  if (!spaceId) {
    return c.json([]);
  }

  const rows = await db
    .select()
    .from(importedMilestones)
    .where(
      and(
        eq(importedMilestones.spaceId, spaceId),
        isNull(importedMilestones.deletedAt)
      )
    )
    .orderBy(desc(importedMilestones.occurredAt));

  return c.json(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body ?? undefined,
      occurredAt: row.occurredAt.toISOString(),
      targetAt: row.targetAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }))
  );
});

// ── Create imported milestone ────────────────────────────────────────────

const createMilestoneSchema = z.object({
  type: z.enum(['note', 'milestone', 'date', 'goal']),
  title: z.string().min(1).max(500),
  body: z.string().max(10000).optional(),
  occurredAt: z.string().datetime({ offset: true }),
  targetAt: z.string().datetime({ offset: true }).nullable().optional(),
});

milestonesRouter.post('/v1/spaces/current/imported-milestones', zValidator('json', createMilestoneSchema), async (c) => {
  const userId = c.var.userId;
  const spaceId = await getActiveSpaceId(userId);

  if (!spaceId) {
    throw badRequest('You must have an active space to add milestones');
  }

  const input = c.req.valid('json');

  const [milestone] = await db
    .insert(importedMilestones)
    .values({
      spaceId,
      createdByUserId: userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      occurredAt: new Date(input.occurredAt),
      targetAt: input.targetAt ? new Date(input.targetAt) : null,
    })
    .returning();

  return c.json({
    id: milestone.id,
    type: milestone.type,
    title: milestone.title,
    body: milestone.body ?? undefined,
    occurredAt: milestone.occurredAt.toISOString(),
    targetAt: milestone.targetAt?.toISOString(),
    createdAt: milestone.createdAt.toISOString(),
  }, 201);
});

export { milestonesRouter };
