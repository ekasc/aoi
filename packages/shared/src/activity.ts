import { z } from 'zod';

export const SPACE_ACTIVITY_KINDS = ['moment_deleted', 'moment_edited'] as const;

export const spaceActivityKindSchema = z.enum(SPACE_ACTIVITY_KINDS);

export type SpaceActivityKind = z.infer<typeof spaceActivityKindSchema>;

/**
 * A single change-log entry for a space. Privacy rule: activity items only
 * ever carry the fact + the actor — never subject content (no titles,
 * bodies, or media).
 */
export const spaceActivityItemSchema = z.object({
  id: z.string(),
  kind: spaceActivityKindSchema,
  actorName: z.string(),
  occurredAt: z.string(),
});

export type SpaceActivityItem = z.infer<typeof spaceActivityItemSchema>;

export const spaceActivityResponseSchema = z.object({
  activity: z.array(spaceActivityItemSchema),
});

export type SpaceActivityResponse = z.infer<typeof spaceActivityResponseSchema>;
