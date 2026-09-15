import { Effect, Data } from 'effect';

import type { Space } from '@aoi/shared';

import { Db, guardedUpdate } from '../effects/d1';
import { nowMs } from '../effects/clock';
import { newId } from '../effects/id';
import { Logger, logInfo, type LoggerService } from '../effects/logger';
import { generateInviteCode, normalizeInviteCode } from '../lib/crypto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from './errors';
import type { DbService } from '../effects/d1';
import type { ClockService } from '../effects/clock';
import type { IdService } from '../effects/id';

/**
 * Spaces domain — exactly-two membership enforced by storage constraints,
 * with guarded atomic transitions on D1.
 *
 * Invariants (all storage-level, race-free):
 * - a user has at most one ACTIVE membership (partial unique
 *   `uq_space_members_user_active`) — create/join conflict → 409;
 * - a space has at most one ACTIVE partner (`uq_space_members_space_partner_active`);
 * - an invite redeems exactly once (`redeemed_at IS NULL` guard inside the
 *   same batch as the member insert) — the whole join is atomic;
 * - leave is a guarded `state='left'` flip that frees the user's active slot
 *   and (for the partner) the partner slot.
 */

export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_INVITE_GENERATION_ATTEMPTS = 3;

/**
 * Internal carrier for a failed D1 batch so storage errors can be classified
 * (typed errors, never thrown through tryPromise's catch — that would Die).
 */
class BatchFailed extends Data.TaggedError('BatchFailed')<{
  readonly cause: unknown;
}> {}

export interface SpaceWithInvite extends Space {
  inviteCode: string;
}

export interface CreateSpaceInput {
  name: string;
  partnerName?: string;
  relationshipStartDate?: string | null;
}

export interface UpdateSpaceInput {
  name?: string;
  partnerName?: string;
  relationshipStartDate?: string;
}

interface SpaceRow {
  id: string;
  name: string;
  partner_name: string | null;
  relationship_start_date: string | null;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
}

function rowToSpace(row: SpaceRow, inviteCode: string, partnerJoined: boolean, inviteExpiresAt: string | null): Space {
  return {
    id: row.id,
    name: row.name,
    createdByUserId: row.created_by_user_id,
    // Absence stays absence: null partner/date serialize as null, never ''
    // or a fabricated placeholder.
    partnerName: row.partner_name ?? null,
    relationshipStartDate: row.relationship_start_date ?? null,
    inviteCode,
    partnerJoined,
    inviteExpiresAt,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const SPACE_SELECT = `
  select id, name, partner_name, relationship_start_date,
         created_by_user_id, created_at, updated_at
  from spaces where id = ?
`;

/**
 * The caller's active space id (or null). Consolidated here — every domain
 * that scopes by space uses this one query.
 */
export const getActiveSpaceId = (
  userId: string
): Effect.Effect<string | null, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare(
            "select space_id from space_members where user_id = ? and state = 'active' limit 1"
          )
          .bind(userId)
          .first<{ space_id: string }>();
        return row?.space_id ?? null;
      },
      catch: () => new InternalError({}),
    })
  );

/**
 * Load a space row + its latest live invite code + whether a partner has
 * joined. Only unexpired, unredeemed invites are presented — an expired
 * code is never shown as active. `partnerJoined` is the only reliable
 * joined signal (partnerName may be the creator's pre-join wording).
 */
const loadSpaceWithInvite = (
  spaceId: string,
  viewerUserId: string,
  now: number
): Effect.Effect<SpaceWithInvite | null, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const space = await s.d1
          .prepare(SPACE_SELECT)
          .bind(spaceId)
          .first<SpaceRow>();
        if (!space) return null;
        const invite = await s.d1
          .prepare(
            'select code, expires_at from space_invites where space_id = ? and redeemed_at is null and revoked_at is null and (expires_at is null or expires_at > ?) order by created_at desc limit 1'
          )
          .bind(spaceId, now)
          .first<{ code: string; expires_at: number | null }>();
        const partner = await s.d1
          .prepare(
            "select 1 as joined from space_members where space_id = ? and user_id != ? and state = 'active' limit 1"
          )
          .bind(spaceId, viewerUserId)
          .first<{ joined: number }>();
        return rowToSpace(
          space,
          invite?.code ?? '',
          partner != null,
          invite ? (invite.expires_at === null ? null : new Date(invite.expires_at).toISOString()) : null
        );
      },
      catch: () => new InternalError({}),
    })
  );

/**
 * Archive a space with no active members left (last leave / solo delete).
 * Deterministic and idempotent: re-running on an archived space is a no-op.
 * Shared memories are NEVER hard-deleted here — the archive flag is a
 * read-side tombstone; rows stay queryable for export/support.
 */
const archiveSpaceIfAbandoned = (
  spaceId: string,
  now: number
): Effect.Effect<void, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const remaining = await s.d1
          .prepare(
            "select 1 as active from space_members where space_id = ? and state = 'active' limit 1"
          )
          .bind(spaceId)
          .first<{ active: number }>();
        if (!remaining) {
          await s.d1
            .prepare('update spaces set archived_at = ?, updated_at = ? where id = ? and archived_at is null')
            .bind(now, now, spaceId)
            .run();
        }
      },
      catch: () => new InternalError({}),
    }).pipe(Effect.as(undefined))
  );

/**
 * GET /v1/spaces/current — the caller's active (non-archived) space + invite.
 * Returns null when the user has no active membership or the space is archived.
 */
export const getCurrentSpaceProgram = (
  userId: string
): Effect.Effect<{ space: SpaceWithInvite | null }, InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) return { space: null };
    const now = yield* nowMs;
    const space = yield* loadSpaceWithInvite(spaceId, userId, now);
    if (!space) return { space: null };
    // Archived spaces are invisible to members (read-side tombstone).
    const archived = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () =>
          s.d1
            .prepare('select archived_at from spaces where id = ?')
            .bind(spaceId)
            .first<{ archived_at: number | null }>(),
        catch: () => new InternalError({}),
      })
    );
    if (archived?.archived_at) return { space: null };
    return { space };
  });

/**
 * POST /v1/spaces — create a space + creator membership + invite in ONE
 * atomic batch. The partial unique on active membership is the enforcement:
 * a second create from the same user fails at the storage layer → 409.
 */
export const createSpaceProgram = (
  userId: string,
  input: CreateSpaceInput
): Effect.Effect<
  { space: SpaceWithInvite },
  ConflictError | InternalError,
  ClockService | IdService | DbService | LoggerService
> =>
  Effect.gen(function* () {
    const now = yield* nowMs;
    const db = yield* Db;

    // Generate the invite code before the batch; a rare collision with the
    // unique index retries with a fresh code (bounded).
    for (let attempt = 0; attempt < MAX_INVITE_GENERATION_ATTEMPTS; attempt += 1) {
      const spaceId = yield* newId;
      const inviteId = yield* newId;
      const code = generateInviteCode();

      const statements = [
        db.d1
          .prepare(
            'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(spaceId, input.name, input.partnerName ?? null, input.relationshipStartDate ?? null, userId, now, now),
        db.d1
          .prepare(
            "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)"
          )
          .bind(spaceId, userId, now),
        db.d1
          .prepare(
            'insert into space_invites (id, space_id, code, code_normalized, created_by_user_id, expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(inviteId, spaceId, code, normalizeInviteCode(code), userId, now + INVITE_TTL_MS, now),
      ];

      // The batch is the enforcement point: classify the storage error
      // WITHOUT throwing from tryPromise's catch (throwing there is a Die).
      const outcome = yield* Effect.tryPromise({
        try: () => db.batch(statements),
        catch: (err) => new BatchFailed({ cause: err }),
      }).pipe(
        Effect.match({
          onFailure: (err) => ({ ok: false as const, err }),
          onSuccess: (results) => ({ ok: true as const, results }),
        })
      );

      if (outcome.ok) {
        yield* logInfo('spaces: created', { spaceId });
        return {
          space: rowToSpace(
            {
              id: spaceId,
              name: input.name,
              partner_name: input.partnerName ?? null,
              relationship_start_date: input.relationshipStartDate ?? null,
              created_by_user_id: userId,
              created_at: now,
              updated_at: now,
            },
            code,
            false,
            new Date(now + INVITE_TTL_MS).toISOString()
          ),
        };
      }

      const err = outcome.err.cause;
      const message = err instanceof Error ? err.message : String(err);
      // SQLite reports `UNIQUE constraint failed: <table>.<column>` (both in
      // better-sqlite3 and D1) — classify by column, not index name.
      // The user's active-membership unique fired → they already have a space.
      if (message.includes('space_members.user_id')) {
        return yield* Effect.fail(conflict('You already have an active space'));
      }
      // Invite code collision → retry with a fresh code.
      if (message.includes('space_invites.code_normalized')) {
        continue;
      }
      return yield* Effect.fail(new InternalError({ cause: err }));
    }

    // Exhausted invite-generation attempts (astronomically unlikely).
    return yield* Effect.fail(new InternalError({}));
  });

/**
 * POST /v1/spaces/join — redeem an invite + insert the partner membership in
 * ONE atomic batch. The redeem is guarded (`redeemed_at is null` AND
 * `revoked_at is null` AND unexpired): the first concurrent redeemer wins;
 * everyone else sees 0 changes → 400/404 via a re-read that tells redeemed,
 * revoked, and expired apart. The partner partial unique rejects a second active
 * partner → 409. Pairing isolation: a space bound to a previous partner
 * rejects any other identity (→ 403), including the bound partner
 * themselves (→ 409) — the slot is never reusable.
 */
export const joinSpaceProgram = (
  userId: string,
  rawInviteCode: string
): Effect.Effect<
  { space: SpaceWithInvite },
  BadRequestError | ForbiddenError | NotFoundError | ConflictError | InternalError,
  DbService | ClockService | IdService | LoggerService
> =>
  Effect.gen(function* () {
    const normalized = normalizeInviteCode(rawInviteCode);
    const now = yield* nowMs;
    const db = yield* Db;

    // Friendly pre-checks (read-only; the batch below is the enforcement).
    const invite = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () =>
          s.d1
            .prepare(
              'select id, space_id, expires_at, redeemed_at from space_invites where code_normalized = ? and revoked_at is null'
            )
            .bind(normalized)
            .first<{ id: string; space_id: string; expires_at: number | null; redeemed_at: number | null }>(),
        catch: () => new InternalError({}),
      })
    );
    if (!invite) {
      return yield* Effect.fail(notFound('Invalid invite code'));
    }
    if (invite.redeemed_at) {
      return yield* Effect.fail(badRequest('Invite code has already been used'));
    }
    if (invite.expires_at !== null && invite.expires_at <= now) {
      return yield* Effect.fail(badRequest('Invite code has expired'));
    }

    const space = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () => s.d1.prepare(SPACE_SELECT).bind(invite.space_id).first<SpaceRow>(),
        catch: () => new InternalError({}),
      })
    );
    if (!space || space.created_by_user_id === userId) {
      // Joining your own space is a no-op-style conflict.
      return yield* Effect.fail(conflict('You are already a member of this space'));
    }
    const archivedAt = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () =>
          s.d1
            .prepare('select archived_at from spaces where id = ?')
            .bind(invite.space_id)
            .first<{ archived_at: number | null }>(),
        catch: () => new InternalError({}),
      })
    );
    if (archivedAt?.archived_at) {
      // Last-member archive closed this space: its unredeemed invite (if any)
      // is dead. Never resurrect an abandoned space via join.
      return yield* Effect.fail(notFound('This space is no longer available'));
    }

    // Pairing isolation: a space that has ever had a partner join is
    // permanently bound to that pairing's history. A different identity may
    // never occupy the partner slot — not via a fresh invite, not via a
    // rotated one, not after the bound partner leaves. The bound partner
    // themselves may not rejoin either (fail-closed: their old membership
    // row is terminal, and silently reactivating it would confuse exactly
    // the history this binding protects). A new pairing needs a new Space.
    const binding = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () =>
          s.d1
            .prepare('select partner_user_id from spaces where id = ?')
            .bind(invite.space_id)
            .first<{ partner_user_id: string | null }>(),
        catch: () => new InternalError({}),
      })
    );
    if (binding?.partner_user_id && binding.partner_user_id !== userId) {
      return yield* Effect.fail(
        forbidden('This space already had its partner — start a new space together')
      );
    }
    if (binding?.partner_user_id && binding.partner_user_id === userId) {
      return yield* Effect.fail(
        conflict('You have already been part of this space')
      );
    }

    const partnerName = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () =>
          s.d1
            .prepare('select name from users where id = ?')
            .bind(userId)
            .first<{ name: string }>(),
        catch: () => new InternalError({}),
      })
    );

    const statements = [
      db.d1
        .prepare(
          `update space_invites set redeemed_by_user_id = ?, redeemed_at = ?
           where id = ? and redeemed_at is null and revoked_at is null
             and (expires_at is null or expires_at > ?)`
        )
        .bind(userId, now, invite.id, now),
      db.d1
        .prepare(
          "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)"
        )
        .bind(invite.space_id, userId, now),
      db.d1
        .prepare('update spaces set partner_name = ?, updated_at = ? where id = ?')
        .bind(partnerName?.name ?? space.name, now, invite.space_id),
      // Bind the pairing atomically with the membership insert: the first
      // partner to commit wins; the loser's member insert rolls the whole
      // batch back, binding included. Conditional so a re-run can never
      // overwrite an established binding.
      db.d1
        .prepare('update spaces set partner_user_id = ? where id = ? and partner_user_id is null')
        .bind(userId, invite.space_id),
    ];

    // Classify storage errors WITHOUT throwing from tryPromise's catch.
    const outcome = yield* Effect.tryPromise({
      try: () => db.batch(statements),
      catch: (err) => new BatchFailed({ cause: err }),
    }).pipe(
      Effect.match({
        onFailure: (err) => ({ ok: false as const, err }),
        onSuccess: (results) => ({ ok: true as const, results }),
      })
    );

    if (!outcome.ok) {
      const err = outcome.err.cause;
      const message = err instanceof Error ? err.message : String(err);
      // SQLite reports `UNIQUE constraint failed: <table>.<column>` — classify
      // by column (space_members.user_id = active-membership unique,
      // space_members.space_id = partner-slot unique).
      if (message.includes('space_members.user_id')) {
        return yield* Effect.fail(
          conflict('You are already in a space. Leave it first to join another.')
        );
      }
      if (message.includes('space_members.space_id')) {
        return yield* Effect.fail(conflict('This space already has two members'));
      }
      return yield* Effect.fail(new InternalError({ cause: err }));
    }

    const redeemChanges = outcome.results[0]?.meta?.changes ?? 0;
    if (redeemChanges === 0) {
      // Guard fired mid-flight (redeemed, revoked, or expired between the
      // pre-check and the batch). Re-read to fail with the truthful cause
      // instead of a generic message.
      const fresh = yield* Effect.flatMap(Db, (s) =>
        Effect.tryPromise({
          try: () =>
            s.d1
              .prepare(
                'select redeemed_at, revoked_at, expires_at from space_invites where id = ?'
              )
              .bind(invite.id)
              .first<{ redeemed_at: number | null; revoked_at: number | null; expires_at: number | null }>(),
          catch: () => new InternalError({}),
        })
      );
      if (!fresh || fresh.revoked_at) {
        return yield* Effect.fail(notFound('Invalid invite code'));
      }
      if (fresh.expires_at !== null && fresh.expires_at <= now) {
        return yield* Effect.fail(badRequest('Invite code has expired'));
      }
      return yield* Effect.fail(badRequest('Invite code has already been used'));
    }

    const joined = yield* loadSpaceWithInvite(invite.space_id, userId, now);
    if (!joined) {
      return yield* Effect.fail(new InternalError({}));
    }
    yield* logInfo('spaces: joined', { spaceId: invite.space_id, userId });
    return { space: joined };
  });

/**
 * PATCH /v1/spaces/current — creator-only updates (name/partnerName/date).
 */
export const updateSpaceProgram = (
  userId: string,
  input: UpdateSpaceInput
): Effect.Effect<
  { space: SpaceWithInvite },
  ForbiddenError | NotFoundError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(notFound('No active space'));
    }
    const now = yield* nowMs;
    const db = yield* Db;

    const space = yield* Effect.flatMap(Db, (s) =>
      Effect.tryPromise({
        try: () => s.d1.prepare(SPACE_SELECT).bind(spaceId).first<SpaceRow>(),
        catch: () => new InternalError({}),
      })
    );
    if (!space) {
      return yield* Effect.fail(notFound('Space not found'));
    }
    if (space.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('Only the space creator can update space details'));
    }

    const name = input.name ?? space.name;
    const partnerName = input.partnerName ?? space.partner_name;
    const relationshipStartDate = input.relationshipStartDate ?? space.relationship_start_date;

    const updated = yield* Effect.tryPromise({
      try: async () =>
        db.d1
          .prepare(
            'update spaces set name = ?, partner_name = ?, relationship_start_date = ?, updated_at = ? where id = ?'
          )
          .bind(name, partnerName, relationshipStartDate, now, spaceId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((updated.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Space not found'));
    }

    const result = yield* loadSpaceWithInvite(spaceId, userId, now);
    if (!result) {
      return yield* Effect.fail(new InternalError({}));
    }
    return { space: result };
  });

/**
 * POST /v1/spaces/current/invite — creator-only invite rotation. Issues a
 * fresh unexpired code while atomically revoking every prior unredeemed
 * code for the space, so a leaked/old code is deterministically dead and
 * only the newly issued invite can admit a member. Never resurrects
 * archived spaces. Rotation on a paired-locked space is allowed but
 * pointless: the new code still cannot admit anyone (see join binding).
 */
export const regenerateInviteProgram = (
  userId: string
): Effect.Effect<
  { inviteCode: string },
  ForbiddenError | NotFoundError | InternalError,
  DbService | ClockService | IdService | LoggerService
> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(notFound('No active space'));
    }
    const now = yield* nowMs;
    const db = yield* Db;
    const space = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select created_by_user_id, archived_at from spaces where id = ?')
          .bind(spaceId)
          .first<{ created_by_user_id: string; archived_at: number | null }>(),
      catch: () => new InternalError({}),
    });
    if (!space) {
      return yield* Effect.fail(notFound('No active space'));
    }
    if (space.archived_at) {
      return yield* Effect.fail(notFound('This space is no longer available'));
    }
    if (space.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('Only the space creator can invite'));
    }

    for (let attempt = 0; attempt < MAX_INVITE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateInviteCode();
      const inviteId = yield* newId;
      // Rotation is one atomic batch: revoke every prior unredeemed invite
      // for the space AND insert the new one together. A concurrent
      // redemption racing this batch has exactly one deterministic winner:
      // if the redeem commits first, its guarded UPDATE still counts (the
      // revoke only touches still-unredeemed rows) and rotation revokes just
      // the leftovers; if rotation commits first, the join's guarded redeem
      // (redeemed_at is null AND revoked_at is null) matches zero rows and
      // the old code fails closed. Either way only the newly issued invite
      // — or the already-redeemed one — can ever admit a member.
      const rotated = yield* Effect.tryPromise({
        try: () =>
          db.batch([
            db.d1
              .prepare(
                'update space_invites set revoked_at = ? where space_id = ? and redeemed_at is null and revoked_at is null'
              )
              .bind(now, spaceId),
            db.d1
              .prepare(
                'insert into space_invites (id, space_id, code, code_normalized, created_by_user_id, expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?)'
              )
              .bind(inviteId, spaceId, code, normalizeInviteCode(code), userId, now + INVITE_TTL_MS, now),
          ]),
        catch: (err) => new BatchFailed({ cause: err }),
      }).pipe(
        Effect.match({
          onFailure: (err) => ({ ok: false as const, err }),
          onSuccess: (result) => ({ ok: true as const, result }),
        })
      );
      if (rotated.ok) {
        yield* logInfo('spaces: invite rotated', { spaceId });
        return { inviteCode: code };
      }
      const message = rotated.err.cause instanceof Error ? rotated.err.cause.message : String(rotated.err.cause);
      if (!message.includes('space_invites.code_normalized')) {
        return yield* Effect.fail(new InternalError({}));
      }
    }
    return yield* Effect.fail(new InternalError({}));
  });

/**
 * POST /v1/spaces/leave — guarded `state='left'` flip. Frees the user's
 * active-membership slot (partial unique) so they can create/join another
 * space; the partner's data in the space is preserved untouched. Shared
 * memories stay for the remaining partner — leaving never deletes history.
 * When the caller was the last active member, the space archives (read-side
 * tombstone; rows retained, invite dead) so no active space/invite lingers
 * in an impossible state.
 */
export const leaveSpaceProgram = (
  userId: string
): Effect.Effect<
  { ok: true },
  NotFoundError | InternalError,
  DbService | ClockService | LoggerService
> =>
  Effect.gen(function* () {
    const now = yield* nowMs;
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(notFound('No active space to leave'));
    }
    const updated = yield* guardedUpdate(
      "update space_members set state = 'left', left_at = ? where user_id = ? and state = 'active'",
      now,
      userId
    );
    if (updated.changes === 0) {
      return yield* Effect.fail(notFound('No active space to leave'));
    }

    // Privacy hygiene: location sharing is ephemeral by design — leaving a
    // space must not leave the caller's position row behind in the old
    // space's scope. Best-effort (a missing row is the common case).
    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () => db.d1.prepare('delete from location_shares where user_id = ?').bind(userId).run(),
      catch: () => new InternalError({}),
    });

    yield* archiveSpaceIfAbandoned(spaceId, now);
    yield* logInfo('spaces: left', { userId });
    return { ok: true as const };
  });
