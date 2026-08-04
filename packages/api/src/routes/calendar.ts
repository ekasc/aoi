import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, gte, lt } from 'drizzle-orm';
import { WEEKLY_RECURRENCE_INSTANCE_COUNT } from '@aoi/shared';
import { db } from '../db/index.js';
import { calendarEvents, spaceMembers } from '../db/schema.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { calendarEventRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';
import { notifyPartnerInSpace } from '../lib/push.js';

const calendarRouter = new Hono();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Resolve the weekday name an ISO timestamp falls on IN ITS OWN OFFSET —
 * the couple's local day, not the server's. Used only to soften partner
 * reminder copy ("They planned something for Friday"); a weekday is the most
 * detail a calendar push may ever carry.
 */
function weekdayForIso(iso: string): string | undefined {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!offsetMatch || offsetMatch[1] === undefined) {
    return WEEKDAY_NAMES[new Date(timestamp).getUTCDay()];
  }

  const sign = offsetMatch[1] === '-' ? -1 : 1;
  const offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  return WEEKDAY_NAMES[new Date(timestamp + offsetMinutes * 60_000).getUTCDay()];
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
    recurrence: z.enum(['none', 'weekly']).optional(),
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

  const labelPreset =
    input.label.preset === 'Other' && input.label.customText
      ? 'Other'
      : input.label.preset;
  const labelCustomText =
    input.label.preset === 'Other' ? (input.label.customText ?? null) : null;
  const reminderMinutesBefore =
    input.reminderMinutesBefore && input.reminderMinutesBefore.length > 0
      ? input.reminderMinutesBefore
      : null;
  const allDay = input.allDay ?? false;
  const together = input.together ?? false;
  const recurrence = input.recurrence === 'weekly' ? 'weekly' : 'none';

  const baseValues = {
    spaceId,
    createdByUserId: userId,
    actor: input.actor,
    actorName: input.actorName,
    title: input.title,
    labelPreset,
    labelCustomText,
    reminderMinutesBefore,
    allDay,
    together,
  };

  let event;

  if (recurrence === 'weekly') {
    // SIMPLE WEEKLY ONLY: expand into a bounded horizon of CONCRETE weekly
    // instances (the original included). They share a `recurrenceGroupId` so
    // they are recognizable, but are otherwise ordinary events — editing or
    // deleting one never touches the rest (no series operations).
    const recurrenceGroupId = crypto.randomUUID();
    const startMs = new Date(input.startsAt).getTime();
    const endMs = new Date(input.endsAt).getTime();

    const instances = Array.from({ length: WEEKLY_RECURRENCE_INSTANCE_COUNT }, (_, week) => ({
      ...baseValues,
      recurrence: 'weekly' as const,
      recurrenceGroupId,
      startsAt: new Date(startMs + week * WEEK_MS),
      endsAt: new Date(endMs + week * WEEK_MS),
    }));

    const [first] = await db.insert(calendarEvents).values(instances).returning();
    event = first;
  } else {
    const [created] = await db
      .insert(calendarEvents)
      .values({
        ...baseValues,
        recurrence,
        recurrenceGroupId: null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      })
      .returning();
    event = created;
  }

  // The partner gets a quiet heads-up that something was planned — vague on
  // purpose (weekday at most), never the title or details. Fire-and-forget:
  // push must never stall the create.
  void notifyPartnerInSpace(spaceId, userId, 'event_added', undefined, weekdayForIso(input.startsAt));

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
  // Applies to THIS instance only — never regenerates or touches a series.
  recurrence: z.enum(['none', 'weekly']).optional(),
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
  if (input.recurrence !== undefined) {
    updateData.recurrence = input.recurrence === 'weekly' ? 'weekly' : 'none';
  }

  const [updated] = await db
    .update(calendarEvents)
    .set(updateData)
    .where(eq(calendarEvents.id, eventId))
    .returning();

  // Quiet heads-up that a shared plan shifted — weekday at most, never the
  // title. Fire-and-forget. Prefer the request's own ISO (it still carries
  // the couple's offset; the stored timestamptz does not).
  void notifyPartnerInSpace(
    existing.spaceId,
    userId,
    'event_updated',
    undefined,
    weekdayForIso(input.startsAt ?? updated.startsAt.toISOString())
  );

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

  // Quiet heads-up that a shared plan was let go — never the title.
  // Fire-and-forget.
  void notifyPartnerInSpace(existing.spaceId, userId, 'event_deleted');

  return c.json({ ok: true });
});

export { calendarRouter };
