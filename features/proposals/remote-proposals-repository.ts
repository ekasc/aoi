import { sortProposalsNewestFirst, type EventProposal, type ProposalListResponse } from '@aoi/shared';

import { apiFetch } from '@/features/api-client';
import type { ProposalsRepository, ProposeInput } from '@/features/proposals/types';

/**
 * Remote proposals repository. The server owns the guards: only the proposee
 * can answer, only while a suggestion is still pending, and the transition
 * is atomic. Accepting copies the suggestion into a real calendar event
 * server-side — the client only refreshes afterwards.
 */
export const remoteProposalsRepository: ProposalsRepository = {
  async list() {
    const response = await apiFetch<ProposalListResponse>(
      '/v1/spaces/current/proposals'
    );
    return sortProposalsNewestFirst(response.proposals);
  },

  propose(input: ProposeInput) {
    return apiFetch<EventProposal>('/v1/spaces/current/proposals', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  accept(proposalId: string) {
    return apiFetch<EventProposal>(`/v1/proposals/${proposalId}/accept`, {
      method: 'POST',
    });
  },

  decline(proposalId: string) {
    return apiFetch<EventProposal>(`/v1/proposals/${proposalId}/decline`, {
      method: 'POST',
    });
  },
};
