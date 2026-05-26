import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calendarEvents, spaceMembers } from '../db/schema.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { calendarEventRowToApi } from '../lib/db.js';

const calendarRouter = new Hono();

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

// ── List events by date range ────────────────────────────────────────────

const listEventsSchema = z.object({
  from: z.string().datetime({ offset: true }), // ISO timestamp
  to: z.string().datetime({ offset: true }),   // ISO timestamp
});

calendarRouter.get('/v1/spaces/current/calendar/events', zValidator('query', listEventsSchema), async (c) => {
  const userId = c.var.userId;
  const { from, to } = c.req.valid('query');

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json([]);
  }

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.spaceId, spaceId),
        isNull(calendarEvents.deletedAt),
        gte(calendarEvents.endsAt, new Date(from)),
        lte(calendarEvents.startsAt, new Date(to))
      )
    )
    .orderBy(calendarEvents.startsAt);

  return c.json(rows.map(calendarEventRowToApi));
});

// ── Get single event ─────────────────────────────────────────────────────

calendarRouter.get('/v1/calendar/events/:id', async (c) => {
  const userId = c.var.userId;
  const eventId = c.req.param('id');

  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.deletedAt)))
    .limit(1);

  if (!event) {
    throw notFound('Event not found');
  }

  // Verify user has access to the space this event belongs to
  const spaceId = event.spaceId;
  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  if (membership.length === 0) {
    throw notFound('Event not found');
  }

  return c.json(calendarEventRowToApi(event));
});

// ── Create event ─────────────────────────────────────────────────────────

const createEventSchema = z.object({
  title: z.string().min(1).max(500),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  actor: z.enum(['you', 'partner']),
  actorName: z.string().min(1).max(200),
  label: z.object({
    preset: z.enum(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']),
    customText: z.string().max(200).optional(),
  }),
});

calendarRouter.post('/v1/spaces/current/calendar/events', zValidator('json', createEventSchema), async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    throw badRequest('You must have an active space to create events');
  }

  const input = c.req.valid('json');

  const [event] = await db
    .insert(calendarEvents)
    .values({
      spaceId,
      createdByUserId: userId,
      actor: input.actor,
      actorName: input.actorName,
      title: input.title,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      labelPreset: input.label.preset === 'Other' && input.label.customText
        ? 'Other'
        : input.label.preset,
      labelCustomText: input.label.preset === 'Other' ? (input.label.customText ?? null) : null,
    })
    .returning();

  return c.json(calendarEventRowToApi(event), 201);
});

// ── Update event ─────────────────────────────────────────────────────────

const updateEventSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  label: z.object({
    preset: z.enum(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']),
    customText: z.string().max(200).optional(),
  }).optional(),
});

calendarRouter.patch('/v1/calendar/events/:id', zValidator('json', updateEventSchema), async (c) => {
  const userId = c.var.userId;
  const eventId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.deletedAt)))
    .limit(1);

  if (!existing) {
    throw notFound('Event not found');
  }

  if (existing.createdByUserId !== userId) {
    throw forbidden('You can only edit your own events');
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
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (input.title !== undefined) updateData.title = input.title;
  if (input.startsAt !== undefined) updateData.startsAt = new Date(input.startsAt);
  if (input.endsAt !== undefined) updateData.endsAt = new Date(input.endsAt);
  if (input.label !== undefined) {
    updateData.labelPreset = input.label.preset;
    updateData.labelCustomText = input.label.preset === 'Other' ? (input.label.customText ?? null) : null;
  }

  const [updated] = await db
    .update(calendarEvents)
    .set(updateData)
    .where(eq(calendarEvents.id, eventId))
    .returning();

  return c.json(calendarEventRowToApi(updated));
});

// ── Delete event (soft delete) ───────────────────────────────────────────

calendarRouter.delete('/v1/calendar/events/:id', async (c) => {
  const userId = c.var.userId;
  const eventId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.deletedAt)))
    .limit(1);

  if (!existing) {
    throw notFound('Event not found');
  }

  if (existing.createdByUserId !== userId) {
    throw forbidden('You can only delete your own events');
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
    .update(calendarEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(calendarEvents.id, eventId));

  return c.json({ ok: true });
});

export { calendarRouter };
