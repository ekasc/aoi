import { describe, it, expect } from 'vitest';
import { sortProposalsNewestFirst, type EventProposal } from '@aoi/shared';

import {
  formatProposalDayLabel,
  formatProposalWhen,
  getAnswerableProposals,
  getPendingProposals,
} from '@/features/proposals/proposal-time';

// Fixed "now": Mon Aug 3, 2026 at noon local time.
const NOW = new Date(2026, 7, 3, 12, 0);

function makeProposal(overrides: Partial<EventProposal> = {}): EventProposal {
  return {
    id: 'proposal-1',
    proposerRole: 'partner',
    proposerName: 'Mara',
    title: 'Farmers market',
    proposedStart: new Date(2026, 7, 8, 10, 0).toISOString(),
    proposedEnd: new Date(2026, 7, 8, 12, 0).toISOString(),
    status: 'pending',
    createdAt: '2026-08-02T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('getAnswerableProposals', () => {
  it('keeps only the partner suggestions still awaiting an answer', () => {
    const answerable = makeProposal();
    const own = makeProposal({ id: 'proposal-2', proposerRole: 'you', proposerName: 'You' });
    const answered = makeProposal({
      id: 'proposal-3',
      status: 'accepted',
      resolvedAt: '2026-08-02T12:00:00.000Z',
    });
    const declinedOwn = makeProposal({
      id: 'proposal-4',
      proposerRole: 'you',
      proposerName: 'You',
      status: 'declined',
      resolvedAt: '2026-08-02T12:00:00.000Z',
    });

    const result = getAnswerableProposals([answerable, own, answered, declinedOwn]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('proposal-1');
  });

  it('returns an empty list when nothing waits', () => {
    expect(getAnswerableProposals([])).toEqual([]);
  });
});

describe('getPendingProposals', () => {
  it('keeps every unanswered suggestion, whoever made it', () => {
    const partnerPending = makeProposal();
    const ownPending = makeProposal({ id: 'proposal-2', proposerRole: 'you' });
    const resolved = makeProposal({
      id: 'proposal-3',
      status: 'accepted',
      resolvedAt: '2026-08-02T12:00:00.000Z',
    });

    const result = getPendingProposals([partnerPending, ownPending, resolved]);

    expect(result.map((proposal) => proposal.id)).toEqual([
      'proposal-1',
      'proposal-2',
    ]);
  });
});

describe('formatProposalDayLabel', () => {
  it('labels today and tomorrow gently', () => {
    expect(
      formatProposalDayLabel(
        makeProposal({ proposedStart: new Date(2026, 7, 3, 18, 0).toISOString() }),
        NOW
      )
    ).toBe('Today');
    expect(
      formatProposalDayLabel(
        makeProposal({ proposedStart: new Date(2026, 7, 4, 10, 0).toISOString() }),
        NOW
      )
    ).toBe('Tomorrow');
  });

  it('falls back to weekday, month, day', () => {
    // Aug 8, 2026 is a Saturday.
    expect(formatProposalDayLabel(makeProposal(), NOW)).toBe('Sat, Aug 8');
  });

  it('stays silent for an unparseable time', () => {
    expect(
      formatProposalDayLabel(makeProposal({ proposedStart: 'not-a-date' }), NOW)
    ).toBe('');
  });
});

describe('formatProposalWhen', () => {
  it('joins the day and the hours in a few words', () => {
    const when = formatProposalWhen(
      makeProposal({
        proposedStart: new Date(2026, 7, 8, 10, 0).toISOString(),
        proposedEnd: new Date(2026, 7, 8, 12, 0).toISOString(),
      }),
      NOW
    );
    expect(when).toBe('Sat, Aug 8 · 10:00 AM - 12:00 PM');
  });

  it('stays silent when either end is unparseable', () => {
    expect(
      formatProposalWhen(makeProposal({ proposedEnd: 'not-a-date' }), NOW)
    ).toBe('');
  });
});

describe('sortProposalsNewestFirst', () => {
  it('orders by createdAt descending without mutating the input', () => {
    const older = makeProposal({ id: 'a', createdAt: '2026-08-01T10:00:00.000Z' });
    const middle = makeProposal({ id: 'b', createdAt: '2026-08-02T10:00:00.000Z' });
    const newest = makeProposal({ id: 'c', createdAt: '2026-08-03T10:00:00.000Z' });
    const input = [middle, newest, older];

    const sorted = sortProposalsNewestFirst(input);

    expect(sorted.map((proposal) => proposal.id)).toEqual(['c', 'b', 'a']);
    expect(input.map((proposal) => proposal.id)).toEqual(['b', 'c', 'a']);
  });
});
