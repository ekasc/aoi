import { z } from 'zod';

import { calendarLabelSchema } from './calendar';

export const PROPOSAL_TITLE_MAX_LENGTH = 120;

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'declined'] as const;

export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const PROPOSAL_PROPOSER_ROLES = ['you', 'partner'] as const;

export const proposalProposerRoleSchema = z.enum(PROPOSAL_PROPOSER_ROLES);

/** Authorship is always expressed relative to the viewer. */
export type ProposalProposerRole = z.infer<typeof proposalProposerRoleSchema>;

export const eventProposalSchema = z.object({
  id: z.string(),
  /** Computed per request from the proposer's user id vs the viewer. */
  proposerRole: proposalProposerRoleSchema,
  /** 'You' for the viewer's own proposals; the partner's display name otherwise. */
  proposerName: z.string(),
  title: z.string(),
  /** ISO-8601 datetime with offset. */
  proposedStart: z.string(),
  /** ISO-8601 datetime with offset; strictly after proposedStart. */
  proposedEnd: z.string(),
  /** Optional calendar label preset, mirrored from the event contract. */
  label: calendarLabelSchema.optional(),
  status: proposalStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export type EventProposal = z.infer<typeof eventProposalSchema>;

export const proposalListResponseSchema = z.object({
  proposals: z.array(eventProposalSchema),
});

export type ProposalListResponse = z.infer<typeof proposalListResponseSchema>;

export const createProposalRequestSchema = z.object({
  title: z.string().min(1).max(PROPOSAL_TITLE_MAX_LENGTH),
  /** ISO-8601 datetime with offset; strictly in the future. */
  proposedStart: z.string(),
  /** ISO-8601 datetime with offset; strictly after proposedStart. */
  proposedEnd: z.string(),
  label: calendarLabelSchema.optional(),
});

export type CreateProposalRequest = z.infer<typeof createProposalRequestSchema>;

/**
 * Canonical list order: newest proposals first. ISO-8601 strings compare
 * lexicographically, so no Date parsing is needed.
 */
export function sortProposalsNewestFirst<T extends Pick<EventProposal, 'createdAt'>>(
  proposals: readonly T[]
): T[] {
  return [...proposals].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return 0;
    }
    return left.createdAt > right.createdAt ? -1 : 1;
  });
}
