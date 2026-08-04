import {
  PROPOSAL_TITLE_MAX_LENGTH,
  type CreateProposalRequest,
  type EventProposal,
  type ProposalListResponse,
  type ProposalProposerRole,
  type ProposalStatus,
} from '@aoi/shared';

// The contract types live in @aoi/shared (single source of truth, mirrored
// by the API's zod schemas); this module only re-exports them alongside the
// proposals-specific repository/context shapes.

export { PROPOSAL_TITLE_MAX_LENGTH };
export type {
  CreateProposalRequest,
  EventProposal,
  ProposalListResponse,
  ProposalProposerRole,
  ProposalStatus,
};

export type ProposeInput = CreateProposalRequest;

export type ProposalsRepository = {
  /** Returns every proposal in the space, newest first. */
  list: () => Promise<EventProposal[]>;
  /** Suggests a time. Only the OTHER partner can answer it. */
  propose: (input: ProposeInput) => Promise<EventProposal>;
  /**
   * Accepts the partner's pending proposal and turns it into a real calendar
   * event. Rejects with a calm message when it is not the viewer's to answer
   * or it was already answered.
   */
  accept: (proposalId: string) => Promise<EventProposal>;
  /** Declines the partner's pending proposal — gently, with no event created. */
  decline: (proposalId: string) => Promise<EventProposal>;
};

export type ProposalsContextValue = {
  proposals: EventProposal[];
  isLoading: boolean;
  error: string | null;
  propose: (input: ProposeInput) => Promise<EventProposal>;
  accept: (proposalId: string) => Promise<EventProposal>;
  decline: (proposalId: string) => Promise<EventProposal>;
  reload: () => Promise<void>;
};
