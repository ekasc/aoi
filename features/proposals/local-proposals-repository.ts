import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROPOSAL_TITLE_MAX_LENGTH,
  sortProposalsNewestFirst,
  type CalendarLabel,
  type CalendarPresetLabel,
  type EventProposal,
  type ProposalStatus,
} from '@aoi/shared';

import {
  initCalendarDb,
  insertEvent,
} from '@/features/calendar/calendar-repository';
import type { ProposalsRepository, ProposeInput } from '@/features/proposals/types';

const STORAGE_KEY_PREFIX = 'aoi.proposals.v1.';

/**
 * Stub mode simulates a partner, plainly documented:
 * - One partner suggestion is seeded on first load so the accept / not-now
 *   flow can be tried offline (it says so in its title).
 * - When YOU suggest a time, the pretend partner accepts it a few seconds
 *   later (checked on the next read — no live timers), exactly like the
 *   letters seed. Acceptance copies the suggestion into a real calendar
 *   event, mirroring the API.
 * Remote mode carries the couple's real suggestions instead.
 */
const STUB_PARTNER_PROPOSAL_ID = 'proposals_stub_partner_seed';
const STUB_PARTNER_ANSWER_DELAY_MS = 8_000;

type StoredProposal = {
  id: string;
  proposerRole: 'you' | 'partner';
  proposerName: string;
  title: string;
  proposedStart: string;
  proposedEnd: string;
  label: CalendarLabel | null;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
};

type StoredProposalsPayload = {
  seededAt: string;
  proposals: StoredProposal[];
};

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function isStoredProposal(value: unknown): value is StoredProposal {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredProposal>;

  return Boolean(
    typeof candidate.id === 'string' &&
      (candidate.proposerRole === 'you' || candidate.proposerRole === 'partner') &&
      typeof candidate.proposerName === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.proposedStart === 'string' &&
      typeof candidate.proposedEnd === 'string' &&
      typeof candidate.status === 'string' &&
      typeof candidate.createdAt === 'string' &&
      (candidate.resolvedAt === null || typeof candidate.resolvedAt === 'string')
  );
}

async function readPayload(key: string): Promise<StoredProposalsPayload | null> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as StoredProposalsPayload).seededAt !== 'string' ||
      !Array.isArray((parsed as StoredProposalsPayload).proposals)
    ) {
      return null;
    }

    const payload = parsed as StoredProposalsPayload;

    return {
      seededAt: payload.seededAt,
      proposals: payload.proposals.filter(isStoredProposal),
    };
  } catch {
    return null;
  }
}

async function writePayload(
  key: string,
  payload: StoredProposalsPayload
): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

function createPartnerSeedProposal(seededAt: Date): StoredProposal {
  // A suggestion a few days out — plainly pretend, so it can be answered.
  const start = new Date(seededAt.getTime() + 5 * 24 * 60 * 60 * 1000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    id: STUB_PARTNER_PROPOSAL_ID,
    proposerRole: 'partner',
    proposerName: 'Them',
    title: 'A pretend suggestion, try answering it',
    proposedStart: start.toISOString(),
    proposedEnd: end.toISOString(),
    label: { preset: 'Date' },
    status: 'pending',
    createdAt: seededAt.toISOString(),
    resolvedAt: null,
  };
}

function toApi(stored: StoredProposal): EventProposal {
  const proposal: EventProposal = {
    id: stored.id,
    proposerRole: stored.proposerRole,
    proposerName: stored.proposerName,
    title: stored.title,
    proposedStart: stored.proposedStart,
    proposedEnd: stored.proposedEnd,
    status: stored.status,
    createdAt: stored.createdAt,
    resolvedAt: stored.resolvedAt,
  };

  if (stored.label) {
    proposal.label = stored.label;
  }

  return proposal;
}

function createId(): string {
  return `proposal_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

/** Build the shared label union constructively (it is strict about Other). */
function toSharedLabel(label: {
  preset: CalendarPresetLabel;
  customText?: string;
}): CalendarLabel {
  return label.preset === 'Other'
    ? { preset: 'Other', customText: label.customText ?? '' }
    : { preset: label.preset };
}

// Mirrors the API's validation (same word-only messages) so the stub rejects
// exactly what the server rejects with a 400.
function assertValidProposalInput(input: ProposeInput): {
  title: string;
  proposedStart: Date;
  proposedEnd: Date;
  label: CalendarLabel | null;
} {
  const title = input.title.trim();

  if (!title) {
    throw new Error('Give the idea a few words');
  }
  if (title.length > PROPOSAL_TITLE_MAX_LENGTH) {
    throw new Error('Keep the suggestion short and sweet');
  }

  const proposedStart = new Date(input.proposedStart);
  const proposedEnd = new Date(input.proposedEnd);
  if (
    Number.isNaN(proposedStart.getTime()) ||
    Number.isNaN(proposedEnd.getTime())
  ) {
    throw new Error("That time doesn't look quite right");
  }

  const now = new Date();
  if (!(proposedStart.getTime() > now.getTime())) {
    throw new Error('A suggestion can only point to the future');
  }
  if (!(proposedEnd.getTime() > proposedStart.getTime())) {
    throw new Error('The ending needs to come after the start');
  }

  const label: CalendarLabel | null = input.label
    ? toSharedLabel(input.label)
    : null;

  return { title, proposedStart, proposedEnd, label };
}

/**
 * The pretend partner answers YOUR pending suggestions a few seconds after
 * they are made — always with a yes. Checked on reads (letters-style), never
 * with live timers, and persisted once. Each acceptance copies the proposal
 * into a real calendar event exactly like the API's accept does.
 */
async function applySimulatedPartnerAnswers(
  payload: StoredProposalsPayload,
  now: Date
): Promise<{ payload: StoredProposalsPayload; changed: boolean }> {
  let changed = false;

  const proposals = await Promise.all(
    payload.proposals.map(async (stored) => {
      if (stored.proposerRole !== 'you' || stored.status !== 'pending') {
        return stored;
      }

      const createdAt = new Date(stored.createdAt).getTime();
      if (Number.isNaN(createdAt) || now.getTime() - createdAt < STUB_PARTNER_ANSWER_DELAY_MS) {
        return stored;
      }

      changed = true;

      // Acceptance copies the suggestion into a real calendar event. The
      // authorship stays with the proposer — here, the device owner.
      try {
        await initCalendarDb();
        await insertEvent({
          title: stored.title,
          startsAt: stored.proposedStart,
          endsAt: stored.proposedEnd,
          actor: 'you',
          actorName: 'You',
          label: stored.label ?? { preset: 'Other' },
          recurrence: 'none',
        });
      } catch {
        // The suggestion still counts as accepted — the calendar copy is a
        // quiet side effect and must never break the answer.
      }

      return {
        ...stored,
        status: 'accepted' as const,
        resolvedAt: now.toISOString(),
      };
    })
  );

  return { payload: { ...payload, proposals }, changed };
}

function assertAnswerable(stored: StoredProposal | undefined): StoredProposal {
  if (!stored) {
    throw new Error('Proposal not found');
  }
  if (stored.proposerRole === 'you') {
    // The proposer never answers their own suggestion.
    throw new Error('This one is theirs to answer');
  }
  if (stored.status !== 'pending') {
    throw new Error('This one has already been answered');
  }
  return stored;
}

/**
 * Device-local proposals for stub mode. Storage is keyed per user, like
 * letters. The seeded partner suggestion and the delayed pretend acceptance
 * exist only so the flow can be felt offline.
 */
export function createLocalProposalsRepository(userId: string): ProposalsRepository {
  const key = storageKey(userId);

  async function loadOrCreate(): Promise<StoredProposalsPayload> {
    const existing = await readPayload(key);

    if (existing) {
      return existing;
    }

    const seeded: StoredProposalsPayload = {
      seededAt: new Date().toISOString(),
      proposals: [createPartnerSeedProposal(new Date())],
    };

    await writePayload(key, seeded);
    return seeded;
  }

  /** Load, let the pretend partner answer anything that is due, persist. */
  async function loadSettled(): Promise<StoredProposalsPayload> {
    const loaded = await loadOrCreate();
    const settled = await applySimulatedPartnerAnswers(loaded, new Date());

    if (settled.changed) {
      await writePayload(key, settled.payload);
    }

    return settled.payload;
  }

  async function resolve(
    proposalId: string,
    nextStatus: 'accepted' | 'declined'
  ): Promise<EventProposal> {
    const payload = await loadSettled();
    const stored = assertAnswerable(
      payload.proposals.find((proposal) => proposal.id === proposalId)
    );

    const now = new Date();
    const resolved: StoredProposal = {
      ...stored,
      status: nextStatus,
      resolvedAt: now.toISOString(),
    };

    // Accepting copies the suggestion into a real calendar event — the
    // authorship stays with the partner who suggested it.
    if (nextStatus === 'accepted') {
      try {
        await initCalendarDb();
        await insertEvent({
          title: stored.title,
          startsAt: stored.proposedStart,
          endsAt: stored.proposedEnd,
          actor: 'partner',
          actorName: stored.proposerName,
          label: stored.label ?? { preset: 'Other' },
          recurrence: 'none',
        });
      } catch {
        // The answer still stands — the calendar copy is a quiet side
        // effect and must never break it.
      }
    }

    await writePayload(key, {
      ...payload,
      proposals: payload.proposals.map((proposal) =>
        proposal.id === proposalId ? resolved : proposal
      ),
    });

    return toApi(resolved);
  }

  return {
    async list() {
      const payload = await loadSettled();
      return sortProposalsNewestFirst(payload.proposals.map(toApi));
    },

    async propose(input) {
      const valid = assertValidProposalInput(input);
      const payload = await loadSettled();
      const now = new Date();

      const stored: StoredProposal = {
        id: createId(),
        proposerRole: 'you',
        proposerName: 'You',
        title: valid.title,
        proposedStart: valid.proposedStart.toISOString(),
        proposedEnd: valid.proposedEnd.toISOString(),
        label: valid.label,
        status: 'pending',
        createdAt: now.toISOString(),
        resolvedAt: null,
      };

      await writePayload(key, {
        ...payload,
        proposals: [stored, ...payload.proposals],
      });

      return toApi(stored);
    },

    accept(proposalId) {
      return resolve(proposalId, 'accepted');
    },

    decline(proposalId) {
      return resolve(proposalId, 'declined');
    },
  };
}
