import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, gte, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calendarEvents, spaceMembers } from '../db/schema.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { calendarEventRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';

const calendarRouter = new Hono();

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

  // Half-open window [from, to): matches the local repository's range query.
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.spaceId, spaceId),
        isNull(calendarEvents.deletedAt),
        gte(calendarEvents.endsAt, new Date(from)),
        lt(calendarEvents.startsAt, new Date(to))
      )
    )
    .orderBy(calendarEvents.startsAt);

  return c.json(rows.map((row) => calendarEventRowToApi(row, userId)));
});

// ── Get single event ─────────────────────────────────────────────────────

calendarRouter.get('/v1/calendar/events/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
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

  return c.json(calendarEventRowToApi(event, userId));
});

// ── Create event ─────────────────────────────────────────────────────────

// Quiet reminders: minutes before the event starts. Bounded so a single
// event can never schedule an unreasonable number of notifications, and
// deduplicated so `[30, 30]` can't double-schedule the same reminder.
const reminderMinutesSchema = z
  .array(z.number().int().min(0).max(2880))
  .max(8)
  .refine((offsets) => new Set(offsets).size === offsets.length, {
    message: 'Reminder offsets must be unique',
  });

const createEventSchema = z
  .object({
    title: z.string().min(1).max(500),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    actor: z.enum(['you', 'partner']),
    actorName: z.string().min(1).max(200),
    label: z.object({
      preset: z.enum(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']),
      customText: z.string().max(200).optional(),
    }),
    reminderMinutesBefore: reminderMinutesSchema.optional(),
    allDay: z.boolean().optional(),
    together: z.boolean().optional(),
  })
  .refine(
    (input) => new Date(input.endsAt).getTime() > new Date(input.startsAt).getTime(),
    { message: 'endsAt must be after startsAt' }
  );

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
      reminderMinutesBefore:
        input.reminderMinutesBefore && input.reminderMinutesBefore.length > 0
          ? input.reminderMinutesBefore
          : null,
      allDay: input.allDay ?? false,
      together: input.together ?? false,
    })
    .returning();

  return c.json(calendarEventRowToApi(event, userId), 201);
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
  reminderMinutesBefore: reminderMinutesSchema.optional(),
  allDay: z.boolean().optional(),
  together: z.boolean().optional(),
});

calendarRouter.patch('/v1/calendar/events/:id', zValidator('param', z.object({ id: z.string().uuid() })), zValidator('json', updateEventSchema), async (c) => {
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

  // Validate the merged range: partial updates must never produce an event
  // that ends before (or exactly when) it starts.
  const nextStartsAt =
    input.startsAt !== undefined ? new Date(input.startsAt) : existing.startsAt;
  const nextEndsAt =
    input.endsAt !== undefined ? new Date(input.endsAt) : existing.endsAt;
  if (nextEndsAt.getTime() <= nextStartsAt.getTime()) {
    throw badRequest('endsAt must be after startsAt');
  }

  const updateData: Partial<typeof calendarEvents.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) updateData.title = input.title;
  if (input.startsAt !== undefined) updateData.startsAt = new Date(input.startsAt);
  if (input.endsAt !== undefined) updateData.endsAt = new Date(input.endsAt);
  if (input.label !== undefined) {
    updateData.labelPreset = input.label.preset;
    updateData.labelCustomText = input.label.preset === 'Other' ? (input.label.customText ?? null) : null;
  }
  if (input.reminderMinutesBefore !== undefined) {
    // An empty array explicitly clears any previously scheduled reminders.
    updateData.reminderMinutesBefore =
      input.reminderMinutesBefore.length > 0 ? input.reminderMinutesBefore : null;
  }
  if (input.allDay !== undefined) updateData.allDay = input.allDay;
  if (input.together !== undefined) updateData.together = input.together;

  const [updated] = await db
    .update(calendarEvents)
    .set(updateData)
    .where(eq(calendarEvents.id, eventId))
    .returning();

  return c.json(calendarEventRowToApi(updated, userId));
});

// ── Delete event (soft delete) ───────────────────────────────────────────

calendarRouter.delete('/v1/calendar/events/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
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
