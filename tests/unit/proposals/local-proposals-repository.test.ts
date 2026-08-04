import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PROPOSAL_TITLE_MAX_LENGTH } from '@aoi/shared';

import { createLocalProposalsRepository } from '@/features/proposals/local-proposals-repository';

// Fixed clock so the simulated partner's timing is deterministic.
const FIXED_NOW = new Date('2026-08-03T12:00:00.000Z');
const FUTURE_START = new Date('2026-08-08T10:00:00.000Z');
const FUTURE_END = new Date('2026-08-08T12:00:00.000Z');

function wordOnly(message: string): boolean {
  return !/\d/.test(message);
}

beforeEach(() => {
  globalThis.__mockAsyncStorage.clear();
  globalThis.__mockDb._clearAll();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('local proposals repository (stub mode)', () => {
  it('seeds one plainly-simulated partner suggestion on first load', async () => {
    const repo = createLocalProposalsRepository('user-local-1');
    const proposals = await repo.list();

    expect(proposals).toHaveLength(1);
    const seeded = proposals[0];
    expect(seeded.proposerRole).toBe('partner');
    expect(seeded.status).toBe('pending');
    expect(seeded.resolvedAt).toBeNull();
    // Plainly pretend — the title says so.
    expect(seeded.title).toContain('pretend');
  });

  it('seeds once — a second repository for the same user sees the same list', async () => {
    const first = createLocalProposalsRepository('user-local-2');
    const initial = await first.list();

    const second = createLocalProposalsRepository('user-local-2');
    const again = await second.list();

    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(initial[0].id);
  });

  it('proposes a time and returns it as pending, newest first', async () => {
    const repo = createLocalProposalsRepository('user-local-3');

    const created = await repo.propose({
      title: 'Farmers market',
      proposedStart: FUTURE_START.toISOString(),
      proposedEnd: FUTURE_END.toISOString(),
    });

    expect(created.proposerRole).toBe('you');
    expect(created.status).toBe('pending');
    expect(created.resolvedAt).toBeNull();

    const proposals = await repo.list();
    expect(proposals).toHaveLength(2);
    expect(proposals[0].id).toBe(created.id);
  });

  describe('validation mirrors the server (word-only)', () => {
    it('rejects an empty title', async () => {
      const repo = createLocalProposalsRepository('user-local-4');
      await expect(
        repo.propose({
          title: '   ',
          proposedStart: FUTURE_START.toISOString(),
          proposedEnd: FUTURE_END.toISOString(),
        })
      ).rejects.toThrow('Give the idea a few words');
    });

    it('rejects an over-long title', async () => {
      const repo = createLocalProposalsRepository('user-local-5');
      await expect(
        repo.propose({
          title: 'a'.repeat(PROPOSAL_TITLE_MAX_LENGTH + 1),
          proposedStart: FUTURE_START.toISOString(),
          proposedEnd: FUTURE_END.toISOString(),
        })
      ).rejects.toThrow('Keep the suggestion short and sweet');
    });

    it('rejects a start in the past', async () => {
      const repo = createLocalProposalsRepository('user-local-6');
      const past = new Date('2026-08-01T10:00:00.000Z');
      await expect(
        repo.propose({
          title: 'A picnic',
          proposedStart: past.toISOString(),
          proposedEnd: FUTURE_END.toISOString(),
        })
      ).rejects.toThrow('A suggestion can only point to the future');
    });

    it('rejects an end that does not come after the start', async () => {
      const repo = createLocalProposalsRepository('user-local-7');
      await expect(
        repo.propose({
          title: 'A picnic',
          proposedStart: FUTURE_START.toISOString(),
          proposedEnd: FUTURE_START.toISOString(),
        })
      ).rejects.toThrow('The ending needs to come after the start');
    });

    it('never echoes numbers or dates in rejection messages', async () => {
      const repo = createLocalProposalsRepository('user-local-8');
      const inputs = [
        {
          title: '',
          proposedStart: FUTURE_START.toISOString(),
          proposedEnd: FUTURE_END.toISOString(),
        },
        {
          title: 'A picnic',
          proposedStart: '2026-08-01T10:00:00.000Z',
          proposedEnd: FUTURE_END.toISOString(),
        },
        {
          title: 'A picnic',
          proposedStart: FUTURE_START.toISOString(),
          proposedEnd: FUTURE_START.toISOString(),
        },
      ];

      for (const input of inputs) {
        let caught: unknown = null;
        try {
          await repo.propose(input);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(wordOnly((caught as Error).message)).toBe(true);
      }
    });
  });

  describe('answering the partner (proposee only)', () => {
    it('accepts the seeded partner suggestion and creates a real event', async () => {
      const repo = createLocalProposalsRepository('user-local-9');
      const [seeded] = await repo.list();

      const accepted = await repo.accept(seeded.id);

      expect(accepted.status).toBe('accepted');
      expect(accepted.resolvedAt).not.toBeNull();

      // Acceptance copies the suggestion into the calendar, authorship
      // staying with the partner who suggested it.
      const events = globalThis.__mockDb.tables['calendar_events'];
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe(seeded.title);
      expect(events[0].actor).toBe('partner');
      expect(events[0].starts_at).toBe(seeded.proposedStart);
      expect(events[0].ends_at).toBe(seeded.proposedEnd);
    });

    it('declines gently and creates no event', async () => {
      const repo = createLocalProposalsRepository('user-local-10');
      const [seeded] = await repo.list();

      const declined = await repo.decline(seeded.id);

      expect(declined.status).toBe('declined');
      expect(declined.resolvedAt).not.toBeNull();
      expect(globalThis.__mockDb.tables['calendar_events'] ?? []).toHaveLength(0);
    });

    it('never lets the proposer answer their own suggestion', async () => {
      const repo = createLocalProposalsRepository('user-local-11');
      const created = await repo.propose({
        title: 'Farmers market',
        proposedStart: FUTURE_START.toISOString(),
        proposedEnd: FUTURE_END.toISOString(),
      });

      await expect(repo.accept(created.id)).rejects.toThrow(
        'This one is theirs to answer'
      );
      await expect(repo.decline(created.id)).rejects.toThrow(
        'This one is theirs to answer'
      );
    });

    it('answers only once — a second resolve is a calm no', async () => {
      const repo = createLocalProposalsRepository('user-local-12');
      const [seeded] = await repo.list();
      await repo.accept(seeded.id);

      await expect(repo.accept(seeded.id)).rejects.toThrow(
        'This one has already been answered'
      );
      await expect(repo.decline(seeded.id)).rejects.toThrow(
        'This one has already been answered'
      );
      // Still exactly one event from the first acceptance.
      expect(globalThis.__mockDb.tables['calendar_events']).toHaveLength(1);
    });

    it('throws calmly for an unknown proposal', async () => {
      const repo = createLocalProposalsRepository('user-local-13');
      await expect(repo.accept('proposal_missing')).rejects.toThrow(
        'Proposal not found'
      );
    });
  });

  describe('the simulated partner answers your suggestions', () => {
    it('accepts a few seconds later — checked on reads, never live timers', async () => {
      const repo = createLocalProposalsRepository('user-local-14');
      const created = await repo.propose({
        title: 'Farmers market',
        proposedStart: FUTURE_START.toISOString(),
        proposedEnd: FUTURE_END.toISOString(),
      });

      // Not yet — the pretend partner is still "thinking".
      const before = await repo.list();
      expect(before.find((p) => p.id === created.id)?.status).toBe('pending');

      // A little while passes; the next read sees the yes.
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 9_000));
      const after = await repo.list();
      const answered = after.find((p) => p.id === created.id);
      expect(answered?.status).toBe('accepted');
      expect(answered?.resolvedAt).not.toBeNull();

      // The simulated acceptance also copied the suggestion into the
      // calendar, under your authorship.
      const events = globalThis.__mockDb.tables['calendar_events'];
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Farmers market');
      expect(events[0].actor).toBe('you');
    });

    it('persists the answer once — later reads never double-create the event', async () => {
      const repo = createLocalProposalsRepository('user-local-15');
      await repo.propose({
        title: 'Farmers market',
        proposedStart: FUTURE_START.toISOString(),
        proposedEnd: FUTURE_END.toISOString(),
      });

      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 9_000));
      await repo.list();
      await repo.list();

      expect(globalThis.__mockDb.tables['calendar_events']).toHaveLength(1);
    });
  });
});
