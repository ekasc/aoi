import type { EventProposal } from '@aoi/shared';

import {
  formatAgendaDayLabel,
  formatTimeRange,
} from '@/features/calendar/calendar-date-utils';

/**
 * Proposals the VIEWER can answer: the partner's suggestions that are still
 * pending. Your own proposals are never yours to answer — they wait for the
 * partner, quietly.
 */
export function getAnswerableProposals(
  proposals: readonly EventProposal[]
): EventProposal[] {
  return proposals.filter(
    (proposal) => proposal.status === 'pending' && proposal.proposerRole === 'partner'
  );
}

/** Every proposal still awaiting an answer, whoever suggested it. */
export function getPendingProposals(
  proposals: readonly EventProposal[]
): EventProposal[] {
  return proposals.filter((proposal) => proposal.status === 'pending');
}

/** Calm day label for a proposed time: Today / Tomorrow / `Sat, Sep 15`. */
export function formatProposalDayLabel(
  proposal: Pick<EventProposal, 'proposedStart'>,
  now: Date = new Date()
): string {
  const start = new Date(proposal.proposedStart);
  if (Number.isNaN(start.getTime())) {
    return '';
  }
  return formatAgendaDayLabel(start, now);
}

/** `Today · 10:00 AM - 12:00 PM` — the full when, in a few words. */
export function formatProposalWhen(
  proposal: Pick<EventProposal, 'proposedStart' | 'proposedEnd'>,
  now: Date = new Date()
): string {
  const start = new Date(proposal.proposedStart);
  const end = new Date(proposal.proposedEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }

  const day = formatProposalDayLabel(proposal, now);
  const time = formatTimeRange(proposal.proposedStart, proposal.proposedEnd);
  return `${day} · ${time}`;
}
