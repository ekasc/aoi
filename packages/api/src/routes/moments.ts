import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, desc, lt, gt, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, spaceMembers } from '../db/schema.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { momentRowToApi } from '../lib/db.js';

const momentsRouter = new Hono();

// ── Helper: get user's active space ──────────────────────────────────────

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

// ── List moments (keyset pagination) ─────────────────────────────────────

const listMomentsSchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

momentsRouter.get('/v1/spaces/current/moments', zValidator('query', listMomentsSchema), async (c) => {
  const userId = c.var.userId;
  const { cursor, limit } = c.req.valid('query');

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json({ moments: [], nextCursor: undefined });
  }

  let query = db
    .select()
    .from(moments)
    .where(
      and(
        eq(moments.spaceId, spaceId),
        isNull(moments.deletedAt),
        cursor
          ? lt(moments.occurredAt, new Date(cursor))
          : undefined
      )
    )
    .orderBy(desc(moments.occurredAt), desc(moments.id))
    .limit(limit + 1); // fetch one extra to detect if there's a next page

  const rows = await query;

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore && items.length > 0
    ? items[items.length - 1].occurredAt.toISOString()
    : undefined;

  return c.json({
    moments: items.map(momentRowToApi),
    nextCursor,
  });
});

// ── Create moment ────────────────────────────────────────────────────────

const createMomentSchema = z.object({
  type: z.enum(['note', 'milestone', 'date', 'goal', 'media', 'trace']),
  title: z.string().max(500).optional().default(''),
  body: z.string().max(10000).optional().default(''),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  targetAt: z.string().datetime({ offset: true }).nullable().optional(),
  mediaPreview: z.string().url().max(2000).nullable().optional(),
  audioUri: z.string().url().max(2000).nullable().optional(),
});

momentsRouter.post('/v1/spaces/current/moments', zValidator('json', createMomentSchema), async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    throw badRequest('You must have an active space to create moments');
  }

  const input = c.req.valid('json');

  const [moment] = await db
    .insert(moments)
    .values({
      spaceId,
      createdByUserId: userId,
      authorRole: 'you', // will be replaced by actual role lookup in production
      authorName: 'You',
      type: input.type,
      title: input.title ?? '',
      body: input.body ?? '',
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      targetAt: input.targetAt ? new Date(input.targetAt) : null,
      mediaPreview: input.mediaPreview ?? null,
      audioUri: input.audioUri ?? null,
    })
    .returning();

  return c.json(momentRowToApi(moment), 201);
});

// ── Update moment ────────────────────────────────────────────────────────

const updateMomentSchema = z.object({
  type: z.enum(['note', 'milestone', 'date', 'goal', 'media', 'trace']).optional(),
  title: z.string().max(500).optional(),
  body: z.string().max(10000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  targetAt: z.string().datetime({ offset: true }).nullable().optional(),
  mediaPreview: z.string().url().max(2000).nullable().optional(),
  audioUri: z.string().url().max(2000).nullable().optional(),
});

momentsRouter.patch('/v1/moments/:id', zValidator('param', z.object({ id: z.string().uuid() })), zValidator('json', updateMomentSchema), async (c) => {
  const userId = c.var.userId;
  const momentId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(moments)
    .where(and(eq(moments.id, momentId), isNull(moments.deletedAt)))
    .limit(1);

  if (!existing) {
    throw notFound('Moment not found');
  }

  if (existing.createdByUserId !== userId) {
    throw forbidden('You can only edit your own moments');
  }

  // Verify user is still an active member of the space
  const [spaceCheck] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, existing.spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  if (!spaceCheck) {
    throw forbidden('You are not an active member of this space');
  }

  const input = c.req.valid('json');
  const updateData: Partial<typeof moments.$inferInsert> = { updatedAt: new Date() };
  if (input.type !== undefined) updateData.type = input.type;
  if (input.title !== undefined) updateData.title = input.title;
  if (input.body !== undefined) updateData.body = input.body;
  if (input.occurredAt !== undefined) updateData.occurredAt = new Date(input.occurredAt);
  if (input.targetAt !== undefined) updateData.targetAt = input.targetAt ? new Date(input.targetAt) : null;
  if (input.mediaPreview !== undefined) updateData.mediaPreview = input.mediaPreview;
  if (input.audioUri !== undefined) updateData.audioUri = input.audioUri;

  const [updated] = await db
    .update(moments)
    .set(updateData)
    .where(eq(moments.id, momentId))
    .returning();

  return c.json(momentRowToApi(updated));
});

// ── Delete moment (soft delete) ──────────────────────────────────────────

momentsRouter.delete('/v1/moments/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const userId = c.var.userId;
  const momentId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(moments)
    .where(and(eq(moments.id, momentId), isNull(moments.deletedAt)))
    .limit(1);

  if (!existing) {
    throw notFound('Moment not found');
  }

  if (existing.createdByUserId !== userId) {
    throw forbidden('You can only delete your own moments');
  }

  // Verify user is still an active member of the space
  const [spaceCheck] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, existing.spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  if (!spaceCheck) {
    throw forbidden('You are not an active member of this space');
  }

  await db
    .update(moments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(moments.id, momentId));

  return c.json({ ok: true });
});

export { momentsRouter };
