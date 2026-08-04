import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { EventProposal } from '@aoi/shared';

import {
  ProposalsProvider,
  useProposals,
} from '@/features/proposals/proposals-context';
import type { ProposalsContextValue } from '@/features/proposals/types';

const fakeRepository = {
  list: vi.fn(),
  propose: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
};

vi.mock('@/features/proposals/local-proposals-repository', () => ({
  createLocalProposalsRepository: () => fakeRepository,
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user-you', displayName: 'You', email: 'you@aoi.test' },
  }),
}));

let captured: ProposalsContextValue | null = null;

function Probe() {
  captured = useProposals();
  return null;
}

function makeProposal(overrides: Partial<EventProposal> = {}): EventProposal {
  return {
    id: 'proposal-1',
    proposerRole: 'partner',
    proposerName: 'Mara',
    title: 'Farmers market',
    proposedStart: '2026-08-08T10:00:00.000Z',
    proposedEnd: '2026-08-08T12:00:00.000Z',
    status: 'pending',
    createdAt: '2026-08-02T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

async function renderProvider() {
  const view = render(
    <ProposalsProvider>
      <Probe />
    </ProposalsProvider>
  );
  await waitFor(() => expect(captured?.isLoading).toBe(false));
  return view;
}

describe('ProposalsProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
  });

  it('loads the space\'s suggestions, newest first', async () => {
    fakeRepository.list.mockResolvedValue([
      makeProposal({ id: 'newer', createdAt: '2026-08-03T10:00:00.000Z' }),
      makeProposal({ id: 'older', createdAt: '2026-08-01T10:00:00.000Z' }),
    ]);

    await renderProvider();

    expect(fakeRepository.list).toHaveBeenCalledTimes(1);
    expect(captured?.proposals.map((proposal) => proposal.id)).toEqual([
      'newer',
      'older',
    ]);
    expect(captured?.error).toBeNull();
  });

  it('surfaces a gentle error when the list cannot be loaded', async () => {
    fakeRepository.list.mockRejectedValue(new Error('network down'));

    await renderProvider();

    expect(captured?.error).toBe('Your suggestions could not be loaded right now.');
    expect(captured?.proposals).toEqual([]);
  });

  it('propose adds the new suggestion at the front, still pending', async () => {
    fakeRepository.list.mockResolvedValue([makeProposal({ id: 'seeded' })]);
    await renderProvider();

    const created = makeProposal({
      id: 'mine',
      proposerRole: 'you',
      proposerName: 'You',
      createdAt: '2026-08-03T12:00:00.000Z',
    });
    fakeRepository.propose.mockResolvedValue(created);

    await act(async () => {
      await captured?.propose({
        title: 'Farmers market',
        proposedStart: '2026-08-08T10:00:00.000Z',
        proposedEnd: '2026-08-08T12:00:00.000Z',
      });
    });

    expect(fakeRepository.propose).toHaveBeenCalledTimes(1);
    expect(captured?.proposals.map((proposal) => proposal.id)).toEqual([
      'mine',
      'seeded',
    ]);
    expect(captured?.proposals[0].status).toBe('pending');
  });

  it('accept swaps the suggestion into its accepted state in place', async () => {
    fakeRepository.list.mockResolvedValue([
      makeProposal({ id: 'seeded', proposerRole: 'partner' }),
    ]);
    await renderProvider();

    fakeRepository.accept.mockResolvedValue(
      makeProposal({
        id: 'seeded',
        status: 'accepted',
        resolvedAt: '2026-08-03T12:00:00.000Z',
      })
    );

    await act(async () => {
      await captured?.accept('seeded');
    });

    expect(fakeRepository.accept).toHaveBeenCalledWith('seeded');
    const resolved = captured?.proposals.find((proposal) => proposal.id === 'seeded');
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.resolvedAt).toBe('2026-08-03T12:00:00.000Z');
  });

  it('decline is just as final — gently', async () => {
    fakeRepository.list.mockResolvedValue([makeProposal({ id: 'seeded' })]);
    await renderProvider();

    fakeRepository.decline.mockResolvedValue(
      makeProposal({
        id: 'seeded',
        status: 'declined',
        resolvedAt: '2026-08-03T12:00:00.000Z',
      })
    );

    await act(async () => {
      await captured?.decline('seeded');
    });

    expect(fakeRepository.decline).toHaveBeenCalledWith('seeded');
    expect(
      captured?.proposals.find((proposal) => proposal.id === 'seeded')?.status
    ).toBe('declined');
  });

  it('a failed resolve bubbles quietly so the screen can reassure', async () => {
    fakeRepository.list.mockResolvedValue([makeProposal({ id: 'seeded' })]);
    await renderProvider();

    fakeRepository.accept.mockRejectedValue(
      new Error('This one has already been answered')
    );

    await act(async () => {
      await expect(captured?.accept('seeded')).rejects.toThrow();
    });

    // The list keeps its last-known truth; the screen re-reads to settle.
    expect(captured?.proposals[0].status).toBe('pending');
  });

  it('reload re-reads the list from the repository', async () => {
    fakeRepository.list
      .mockResolvedValueOnce([makeProposal({ id: 'first' })])
      .mockResolvedValueOnce([
        makeProposal({ id: 'second', createdAt: '2026-08-03T10:00:00.000Z' }),
      ]);

    await renderProvider();
    expect(captured?.proposals.map((proposal) => proposal.id)).toEqual(['first']);

    await act(async () => {
      await captured?.reload();
    });

    expect(fakeRepository.list).toHaveBeenCalledTimes(2);
    expect(captured?.proposals.map((proposal) => proposal.id)).toEqual(['second']);
  });
});
