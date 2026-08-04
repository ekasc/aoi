/**
 * Proposals — "how about Saturday?" A gentle suggestion from one partner to
 * the other. Only the PROPOSEE can resolve it (accept / decline), only while
 * it is still pending, and accepting turns it into a real calendar event.
 *
 * Privacy: proposal pushes never carry the title or the date — the API copy
 * is fixed and vague. Both partners can list every proposal in the space;
 * authorship is expressed relative to the viewer (`proposerRole`).
 */

import type { CalendarLabel } from './calendar.js';

export const PROPOSAL_TITLE_MAX_LENGTH = 120;

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'declined'] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Authorship is always expressed relative to the viewer. */
export type ProposalProposerRole = 'you' | 'partner';

export type EventProposal = {
  id: string;
  /** Computed per request from the proposer's user id vs the viewer. */
  proposerRole: ProposalProposerRole;
  /** 'You' for the viewer's own proposals; the partner's display name otherwise. */
  proposerName: string;
  title: string;
  /** ISO-8601 datetime with offset. */
  proposedStart: string;
  /** ISO-8601 datetime with offset; strictly after proposedStart. */
  proposedEnd: string;
  /** Optional calendar label preset, mirrored from the event contract. */
  label?: CalendarLabel;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type ProposalListResponse = {
  proposals: EventProposal[];
};

export type CreateProposalRequest = {
  title: string;
  /** ISO-8601 datetime with offset; strictly in the future. */
  proposedStart: string;
  /** ISO-8601 datetime with offset; strictly after proposedStart. */
  proposedEnd: string;
  label?: CalendarLabel;
};

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
