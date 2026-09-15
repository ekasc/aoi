import { z } from 'zod';

export type CalendarActor = 'you' | 'partner';

/**
 * Recurrence is deliberately SIMPLE: only weekly, and the API expands a
 * weekly event into concrete, ordinary events (a bounded horizon) — there
 * are no series operations. Editing or deleting one instance never touches
 * the rest.
 */
export const CALENDAR_RECURRENCES = ['none', 'weekly'] as const;

export const calendarRecurrenceSchema = z.enum(CALENDAR_RECURRENCES);

export type CalendarEventRecurrence = z.infer<typeof calendarRecurrenceSchema>;

/**
 * How many concrete weekly instances a `recurrence: 'weekly'` create expands
 * into (the original week included). Bounded on purpose: instances are
 * ordinary events, and there are no series operations.
 */
export const WEEKLY_RECURRENCE_INSTANCE_COUNT = 13;

export const CALENDAR_PRESET_LABELS = [
  'Work',
  'Gym',
  'Travel',
  'Date',
  'Family',
  'Other',
] as const;

export const calendarPresetLabelSchema = z.enum(CALENDAR_PRESET_LABELS);

export type CalendarPresetLabel = z.infer<typeof calendarPresetLabelSchema>;

/**
 * A label is either a preset (no custom text) or `Other` + required custom
 * text. Defined explicitly (not `z.infer`) so the schema can reference it
 * back via `z.ZodType<CalendarLabel>` without a circular type.
 */
export type CalendarLabel =
  | { preset: CalendarPresetLabel; customText?: never }
  | { preset: 'Other'; customText: string };

/**
 * Validation: a non-`Other` preset must not carry `customText`; `Other` may
 * carry a non-empty `customText`, but is also valid WITHOUT one (the server
 * serializes label-less accepted proposals as `{ preset: 'Other' }`).
 * Expressed as a single object + superRefine (instead of a `z.never()`
 * union member) so the schema also renders in OpenAPI — runtime rejection
 * semantics are preserved.
 */
export const calendarLabelSchema = z
  .object({
    preset: z.enum(CALENDAR_PRESET_LABELS),
    customText: z.string().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.preset !== 'Other' && value.customText !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Custom text is only allowed for Other' });
    }
  }) as z.ZodType<CalendarLabel>;

export const calendarActorSchema = z.enum(['you', 'partner']);

export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  actor: calendarActorSchema,
  actorName: z.string(),
  label: calendarLabelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Minutes before start when a quiet local reminder should fire. */
  reminderMinutesBefore: z.array(z.number()).optional(),
  /** All-day event: no time-of-day; UI shows "All day" instead of times. */
  allDay: z.boolean().optional(),
  /** The couple is jointly involved — counts toward the countdown lane. */
  together: z.boolean().optional(),
  /**
   * Weekly recurrence marker. A weekly event is expanded into concrete
   * instances server-side; each instance is an ordinary event. Absent means
   * `'none'`.
   */
  recurrence: calendarRecurrenceSchema.optional(),
  /**
   * Per-request ownership signal from the API (creator user id vs viewer).
   * Optional for locally constructed events; unknown must mean "not own".
   */
  isOwn: z.boolean().optional(),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarEventRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  actor: calendarActorSchema,
  actorName: z.string(),
  labelPreset: calendarPresetLabelSchema,
  labelCustomText: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reminderMinutesBefore: z.array(z.number()).nullable(),
  allDay: z.boolean(),
  together: z.boolean(),
  recurrence: calendarRecurrenceSchema,
});

export type CalendarEventRow = z.infer<typeof calendarEventRowSchema>;

export const createCalendarEventRequestSchema = z.object({
  title: z.string().min(1),
  startsAt: z.string(),
  endsAt: z.string(),
  actor: calendarActorSchema,
  actorName: z.string(),
  label: calendarLabelSchema,
  reminderMinutesBefore: z.array(z.number()).optional(),
  allDay: z.boolean().optional(),
  together: z.boolean().optional(),
  /** 'weekly' expands into concrete weekly instances server-side. */
  recurrence: calendarRecurrenceSchema.optional(),
});

export type CreateCalendarEventRequest = z.infer<
  typeof createCalendarEventRequestSchema
>;

export const updateCalendarEventRequestSchema = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  label: calendarLabelSchema.optional(),
  reminderMinutesBefore: z.array(z.number()).optional(),
  allDay: z.boolean().optional(),
  together: z.boolean().optional(),
  /** Applies to this single instance only — never regenerates a series. */
  recurrence: calendarRecurrenceSchema.optional(),
});

export type UpdateCalendarEventRequest = z.infer<
  typeof updateCalendarEventRequestSchema
>;
