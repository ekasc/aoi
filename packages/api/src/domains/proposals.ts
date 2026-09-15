import { Effect } from 'effect';

import {
  type CalendarPresetLabel,
  type CreateProposalRequest,
  type EventProposal,
  type ProposalStatus,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, batch, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  badRequest,
  forbidden,
  notFound,
} from './errors';

/**
 * Proposals domain — "how about Saturday?". One partner suggests a time;
 * only the OTHER partner can accept or decline, and only while it is still
 * pending. Accepting copies the proposal into a real calendar event
 * (actor = proposer) in ONE atomic batch with the guarded status flip, so a
 * failed event insert rolls the status back — never "accepted with no
 * event". Titles and times never echo back; pushes carry kind only.
 */

export interface ProposalRow {
  id: string;
  space_id: string;
  proposer_user_id: string;
  title: string;
  proposed_start: number;
  proposed_end: number;
  label: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

const PROPOSAL_SELECT = `
  select id, space_id, proposer_user_id, title, proposed_start,
         proposed_end, label, status, created_at, resolved_at
  from event_proposals
`;

/** Viewer-relative serializer — authorship is always relative to the viewer. */
export function proposalToApi(
  row: ProposalRow,
  proposerName: string,
  viewerUserId: string
): EventProposal {
  const isOwn = row.proposer_user_id === viewerUserId;
  const label = row.label !== null ? (JSON.parse(row.label) as { preset: string; customText?: string }) : null;

  const proposal: EventProposal = {
    id: row.id,
    proposerRole: isOwn ? 'you' : 'partner',
    proposerName: isOwn ? 'You' : proposerName,
    title: row.title,
    proposedStart: new Date(row.proposed_start).toISOString(),
    proposedEnd: new Date(row.proposed_end).toISOString(),
    status: row.status as ProposalStatus,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
  };

  if (label && typeof label.preset === 'string') {
    proposal.label =
      label.preset === 'Other' && label.customText
        ? { preset: 'Other', customText: label.customText }
        : { preset: label.preset as CalendarPresetLabel };
  }

  return proposal;
}

// ── Create a proposal ────────────────────────────────────────────────────

export const createProposalProgram = (
  userId: string,
  input: CreateProposalRequest
): Effect.Effect<EventProposal, BadRequestError | ForbiddenError | InternalError, DbService | JobQueueService | ClockService | IdService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to suggest a time'));
    }

    const proposedStart = Date.parse(input.proposedStart);
    const proposedEnd = Date.parse(input.proposedEnd);
    if (!Number.isFinite(proposedStart) || !Number.isFinite(proposedEnd)) {
      return yield* Effect.fail(badRequest("That time doesn't look quite right"));
    }

    const at = yield* nowMs;
    if (!(proposedStart > at)) {
      return yield* Effect.fail(badRequest('A suggestion can only point to the future'));
    }
    if (!(proposedEnd > proposedStart)) {
      return yield* Effect.fail(badRequest('The ending needs to come after the start'));
    }

    const db = yield* Db;
    const id = yield* newId;

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into event_proposals
               (id, space_id, proposer_user_id, title, proposed_start,
                proposed_end, label, status, created_at, resolved_at)
             values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, null)`
          )
          .bind(
            id,
            spaceId,
            userId,
            input.title,
            proposedStart,
            proposedEnd,
            input.label ? JSON.stringify(input.label) : null,
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

    yield* enqueueJob({ type: 'push.deliver', kind: 'proposal_received', spaceId, fromUserId: userId });
    return proposalToApi(
      {
        id,
        space_id: spaceId,
        proposer_user_id: userId,
        title: input.title,
        proposed_start: proposedStart,
        proposed_end: proposedEnd,
        label: input.label ? JSON.stringify(input.label) : null,
        status: 'pending',
        created_at: at,
        resolved_at: null,
      },
      'You',
      userId
    );
  });

// ── List proposals ───────────────────────────────────────────────────────

export const listProposalsProgram = (
  userId: string
): Effect.Effect<EventProposal[], InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return [];
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select p.id, p.space_id, p.proposer_user_id, p.title,
                    p.proposed_start, p.proposed_end, p.label, p.status,
                    p.created_at, p.resolved_at, u.name as proposer_name
             from event_proposals p
             join users u on u.id = p.proposer_user_id
             where p.space_id = ?
             order by p.created_at desc, p.id desc`
          )
          .bind(spaceId)
          .all<(ProposalRow & { proposer_name: string })>(),
      catch: () => new InternalError({}),
    });

    return (rows.results ?? []).map((row) =>
      proposalToApi(
        {
          id: row.id,
          space_id: row.space_id,
          proposer_user_id: row.proposer_user_id,
          title: row.title,
          proposed_start: row.proposed_start,
          proposed_end: row.proposed_end,
          label: row.label,
          status: row.status,
          created_at: row.created_at,
          resolved_at: row.resolved_at,
        },
        row.proposer_name,
        userId
      )
    );
  });

// ── Resolve (accept / decline) ───────────────────────────────────────────

interface ResolvableContext {
  proposal: ProposalRow;
  proposerName: string;
}

/**
 * Guard chain: proposal exists, viewer is an active member of its space
 * (another space's id is indistinguishable from no proposal at all), it is
 * the partner's (never your own), and still pending.
 */
function guardResolvable(
  proposalId: string,
  userId: string
): Effect.Effect<ResolvableContext, NotFoundError | ForbiddenError | BadRequestError | InternalError, DbService> {
  return Effect.gen(function* () {
    const db = yield* Db;
    const proposal = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${PROPOSAL_SELECT} where id = ? limit 1`)
          .bind(proposalId)
          .first<ProposalRow>(),
      catch: () => new InternalError({}),
    });
    if (!proposal) {
      return yield* Effect.fail(notFound('Proposal not found'));
    }

    const member = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(proposal.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!member) {
      return yield* Effect.fail(notFound('Proposal not found'));
    }

    if (proposal.proposer_user_id === userId) {
      return yield* Effect.fail(forbidden('This one is theirs to answer'));
    }
    if (proposal.status !== 'pending') {
      return yield* Effect.fail(badRequest('This one has already been answered'));
    }

    const proposer = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select u.name from space_members sm
             join users u on u.id = sm.user_id
             where sm.space_id = ? and sm.user_id = ? and sm.state = 'active'
             limit 1`
          )
          .bind(proposal.space_id, proposal.proposer_user_id)
          .first<{ name: string }>(),
      catch: () => new InternalError({}),
    });

    return { proposal, proposerName: proposer?.name ?? 'Your partner' };
  });
}

/**
 * Accept: atomic guarded status flip + calendar event insert in ONE batch.
 * The first accept wins (the guarded UPDATE matches only while pending) and
 * a failed event insert rolls the status back — never "accepted with no
 * event". Returns the resolved proposal.
 */
export const acceptProposalProgram = (
  userId: string,
  proposalId: string
): Effect.Effect<EventProposal, BadRequestError | ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | ClockService | IdService | LoggerService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const { proposal, proposerName } = yield* guardResolvable(proposalId, userId);

    const at = yield* nowMs;
    const eventId = yield* newId;

    // Carry the proposal's label into the calendar event (the legacy
    // behavior) — a label of `Date` should not degrade to `Other`.
    let labelPreset: string = 'Other';
    let labelCustomText: string | null = null;
    if (proposal.label !== null) {
      try {
        const parsed = JSON.parse(proposal.label) as { preset?: string; customText?: string };
        if (typeof parsed.preset === 'string') {
          labelPreset = parsed.preset;
          labelCustomText = parsed.preset === 'Other' ? (parsed.customText ?? null) : null;
        }
      } catch {
        // Stored by us; a corrupt row degrades to Other.
      }
    }

    // The proposer's authorship role snapshot (same rule as moments) —
    // resolved BEFORE the batch because `actor` is NOT NULL.
    const proposerRole = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select role from space_members
             where space_id = ? and user_id = ? and state = 'active' limit 1`
          )
          .bind(proposal.space_id, proposal.proposer_user_id)
          .first<{ role: 'you' | 'partner' }>(),
      catch: () => new InternalError({}),
    });
    const actor = proposerRole?.role ?? 'partner';

    const results = yield* batch([
      db.d1
        .prepare(
          `update event_proposals set status = 'accepted', resolved_at = ?
           where id = ? and status = 'pending'`
        )
        .bind(at, proposalId),
      db.d1
        .prepare(
          `insert into calendar_events
             (id, space_id, created_by_user_id, actor, actor_name, title,
              starts_at, ends_at, label_preset, label_custom_text,
              reminder_minutes_before, all_day, together, recurrence,
              recurrence_group_id, created_at, updated_at)
           select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, 0, 'none', null, ?, ?
           where (select changes()) > 0`
        )
        .bind(
          eventId,
          proposal.space_id,
          proposal.proposer_user_id,
          actor,
          proposerName,
          proposal.title,
          proposal.proposed_start,
          proposal.proposed_end,
          labelPreset,
          labelCustomText,
          at,
          at
        ),
    ]);

    if ((results[0]?.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(badRequest('This one has already been answered'));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'proposal_accepted', spaceId: proposal.space_id, fromUserId: userId });

    return proposalToApi(
      {
        ...proposal,
        status: 'accepted',
        resolved_at: at,
      },
      proposerName,
      userId
    );
  });

/**
 * Decline: atomic guarded status flip only. Same guard chain as accept.
 */
export const declineProposalProgram = (
  userId: string,
  proposalId: string
): Effect.Effect<EventProposal, BadRequestError | ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const { proposal, proposerName } = yield* guardResolvable(proposalId, userId);

    const at = yield* nowMs;
    const result = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update event_proposals set status = 'declined', resolved_at = ?
             where id = ? and status = 'pending'`
          )
          .bind(at, proposalId)
          .run(),
      catch: () => new InternalError({}),
    });

    if ((result.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(badRequest('This one has already been answered'));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'proposal_declined', spaceId: proposal.space_id, fromUserId: userId });

    return proposalToApi(
      {
        ...proposal,
        status: 'declined',
        resolved_at: at,
      },
      proposerName,
      userId
    );
  });
