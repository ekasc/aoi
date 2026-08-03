import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import {
  SOMEDAY_CATEGORIES,
  SOMEDAY_NOTE_MAX_LENGTH,
  SOMEDAY_TITLE_MAX_LENGTH,
  sortSomedayItems,
} from '@aoi/shared';
import { db } from '../db/index.js';
import { somedayItems, spaceMembers } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { somedayItemRowToApi } from '../lib/db.js';

const somedayRouter = new Hono();

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

// ── List items ───────────────────────────────────────────────────────────
// Canonical order (shared with the client): open items first (newest
// first), then checked-off items (most recently checked first).

somedayRouter.get('/v1/spaces/current/someday', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json({ items: [] });
  }

  const rows = await db
    .select()
    .from(somedayItems)
    .where(eq(somedayItems.spaceId, spaceId));

  const items = sortSomedayItems(rows.map((row) => somedayItemRowToApi(row, userId)));

  return c.json({ items });
});

// ── Create item ──────────────────────────────────────────────────────────

const createSomedayItemSchema = z.object({
  title: z.string().trim().min(1).max(SOMEDAY_TITLE_MAX_LENGTH),
  note: z.string().trim().max(SOMEDAY_NOTE_MAX_LENGTH).optional(),
  category: z.enum(SOMEDAY_CATEGORIES),
});

somedayRouter.post(
  '/v1/spaces/current/someday',
  zValidator('json', createSomedayItemSchema),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to add someday items');
    }

    const input = c.req.valid('json');

    const [item] = await db
      .insert(somedayItems)
      .values({
        spaceId,
        createdByUserId: userId,
        title: input.title,
        note: input.note && input.note.length > 0 ? input.note : null,
        category: input.category,
      })
      .returning();

    return c.json(somedayItemRowToApi(item, userId), 201);
  }
);

// ── Update item (check-off, undo, edits) ─────────────────────────────────
// Both members of the space may check off, undo, and edit any item. Only
// meaningful transitions write — repeated check-offs or no-op patches never
// create churn.

const updateSomedayItemSchema = z
  .object({
    title: z.string().trim().min(1).max(SOMEDAY_TITLE_MAX_LENGTH).optional(),
    note: z.string().trim().max(SOMEDAY_NOTE_MAX_LENGTH).optional(),
    category: z.enum(SOMEDAY_CATEGORIES).optional(),
    checked: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Nothing to update',
  });

somedayRouter.patch(
  '/v1/someday/:id',
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', updateSomedayItemSchema),
  async (c) => {
    const userId = c.var.userId;
    const itemId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(somedayItems)
      .where(eq(somedayItems.id, itemId))
      .limit(1);

    if (!existing) {
      throw notFound('Someday item not found');
    }

    // Membership gate: non-members get a 404 so other spaces' items never
    // leak existence.
    const [membership] = await db
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

    if (!membership) {
      throw notFound('Someday item not found');
    }

    const input = c.req.valid('json');

    const updateData: Partial<typeof somedayItems.$inferInsert> = {};
    if (input.title !== undefined && input.title !== existing.title) {
      updateData.title = input.title;
    }
    if (input.note !== undefined) {
      // An empty note explicitly clears a previously saved one.
      const nextNote = input.note.length > 0 ? input.note : null;
      if (nextNote !== existing.note) {
        updateData.note = nextNote;
      }
    }
    if (input.category !== undefined && input.category !== existing.category) {
      updateData.category = input.category;
    }
    if (input.checked === true && existing.checkedAt === null) {
      updateData.checkedAt = new Date();
      updateData.checkedByUserId = userId;
    }
    if (input.checked === false && existing.checkedAt !== null) {
      updateData.checkedAt = null;
      updateData.checkedByUserId = null;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(somedayItemRowToApi(existing, userId));
    }

    const [updated] = await db
      .update(somedayItems)
      .set(updateData)
      .where(eq(somedayItems.id, itemId))
      .returning();

    return c.json(somedayItemRowToApi(updated, userId));
  }
);

export { somedayRouter };
