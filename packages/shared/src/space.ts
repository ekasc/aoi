import { z } from 'zod';

export const SPACE_MEMBER_ROLES = ['you', 'partner'] as const;

export const spaceMemberRoleSchema = z.enum(SPACE_MEMBER_ROLES);

export type SpaceMemberRole = z.infer<typeof spaceMemberRoleSchema>;

export const SPACE_MEMBER_STATES = ['active', 'left'] as const;

export const spaceMemberStateSchema = z.enum(SPACE_MEMBER_STATES);

export type SpaceMemberState = z.infer<typeof spaceMemberStateSchema>;

export const spaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdByUserId: z.string(),
  // Absent partner name / start date serialize as null (never '', never a
  // fabricated placeholder). Matches the D1 nullability after migration
  // 0003 and the client null/unset model.
  partnerName: z.string().nullable(),
  relationshipStartDate: z.string().nullable(),
  inviteCode: z.string(),
  /**
   * True when another active member exists besides the viewer. The only
   * reliable joined signal: partnerName may hold the creator's pre-join
   * wording, and inviteCode goes quiet on expiry as well as on join.
   */
  partnerJoined: z.boolean(),
  /**
   * Expiry of the presented invite code (ISO), or null when no live invite
   * is shown (joined, expired-without-replacement, or none). Lets clients
   * state expiry truthfully instead of guessing from space creation.
   */
  inviteExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Space = z.infer<typeof spaceSchema>;

export const createSpaceRequestSchema = z.object({
  name: z.string().min(1).max(200),
  partnerName: z.string().min(1).max(200).optional(),
  relationshipStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
});

export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;

export const createSpaceResponseSchema = z.object({
  space: spaceSchema,
  inviteCode: z.string(),
});

export type CreateSpaceResponse = z.infer<typeof createSpaceResponseSchema>;

export const joinSpaceRequestSchema = z.object({
  inviteCode: z.string().min(1),
});

export type JoinSpaceRequest = z.infer<typeof joinSpaceRequestSchema>;

export const updateSpaceRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  partnerName: z.string().min(1).max(200).optional(),
  relationshipStartDate: z.string().optional(),
});

export type UpdateSpaceRequest = z.infer<typeof updateSpaceRequestSchema>;

export const IMPORTED_MILESTONE_TYPES = ['note', 'milestone', 'date', 'goal'] as const;

export const importedMilestoneTypeSchema = z.enum(IMPORTED_MILESTONE_TYPES);

export type ImportedMilestoneType = z.infer<typeof importedMilestoneTypeSchema>;

export const importedMilestoneSchema = z.object({
  id: z.string(),
  type: importedMilestoneTypeSchema,
  title: z.string(),
  body: z.string().optional(),
  occurredAt: z.string(),
  targetAt: z.string().optional(),
  createdAt: z.string(),
});

export type ImportedMilestone = z.infer<typeof importedMilestoneSchema>;

export const createImportedMilestoneRequestSchema = z.object({
  type: importedMilestoneTypeSchema,
  title: z.string(),
  body: z.string().optional(),
  occurredAt: z.string(),
  targetAt: z.string().optional(),
});

export type CreateImportedMilestoneRequest = z.infer<
  typeof createImportedMilestoneRequestSchema
>;
