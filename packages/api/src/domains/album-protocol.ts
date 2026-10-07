import { Effect } from 'effect';

import {
  wireDeviceRecordSchema,
  wireDeviceTombstoneSchema,
  wireRecoveryEnvelopeSchema,
  wireSpaceKeyEnvelopeSchema,
  wireSpaceTrustAnchorSchema,
  type WireAlbumProtocolSnapshot,
  type WireDeviceRecord,
  type WireDeviceTombstone,
  type WireRecoveryEnvelope,
  type WireSpaceKeyEnvelope,
  type WireSpaceTrustAnchor,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  badRequest,
  conflict,
  forbidden,
} from './errors';

/**
 * The protocol's server side.
 *
 * This is storage and authority, not cryptography. The server cannot tell
 * whether a signature is good and does not try. What it can do is decide who
 * owns a row, whether a revision moved forward, and whether the caller is
 * allowed to write at all, and those are exactly the three things the old
 * shared-blob backup got wrong.
 *
 * Every payload is the canonical wire object, stored as the output of its own
 * schema and parsed again on the way out, so there is one representation of a
 * signed object rather than two that can drift apart.
 *
 * The old `/album/backup` endpoint and `album_backups` table stay exactly as
 * they are. The session path still reads them, and they come out in the cutover
 * commit, not this one.
 */

type WireSchema<T> = { parse: (value: unknown) => T };

const one = <T>(sql: string, ...params: unknown[]): Effect.Effect<T | null, InternalError, DbService> =>
  Effect.flatMap(Db, (db) =>
    Effect.tryPromise({
      try: () => db.d1.prepare(sql).bind(...params).first<T>(),
      catch: () => new InternalError({}),
    })
  );

const all = <T>(sql: string, ...params: unknown[]): Effect.Effect<T[], InternalError, DbService> =>
  Effect.flatMap(Db, (db) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.d1.prepare(sql).bind(...params).all<T>();
        return result.results ?? [];
      },
      catch: () => new InternalError({}),
    })
  );

const execute = (
  sql: string,
  ...params: unknown[]
): Effect.Effect<{ changes: number }, InternalError, DbService> =>
  Effect.flatMap(Db, (db) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.d1.prepare(sql).bind(...params).run();
        return { changes: result.meta?.changes ?? 0 };
      },
      catch: () => new InternalError({}),
    })
  );

/**
 * Stored by us through the same schema, so a failure here is a server bug rather
 * than hostile input, and it fails loudly. Dropping the row quietly would be
 * worse than a 500: a dropped tombstone is a device that looks trusted again.
 */
const readPayload = <T>(schema: WireSchema<T>, payload: string): Effect.Effect<T, InternalError> =>
  Effect.try({
    try: () => schema.parse(JSON.parse(payload)) as T,
    catch: () => new InternalError({}),
  });

/** Both sides come from the same schema, so key order is the schema's order. */
const samePayload = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const isSpaceCreator = (
  spaceId: string,
  userId: string
): Effect.Effect<boolean, InternalError, DbService> =>
  Effect.map(
    one<{ id: string }>('select id from spaces where id = ? and created_by_user_id = ?', spaceId, userId),
    (row) => row !== null
  );

const deviceOwner = (
  spaceId: string,
  deviceId: string
): Effect.Effect<string | null, InternalError, DbService> =>
  Effect.map(
    one<{ owner_user_id: string }>(
      'select owner_user_id from album_device_records where space_id = ? and device_id = ?',
      spaceId,
      deviceId
    ),
    (row) => row?.owner_user_id ?? null
  );

const EMPTY_SNAPSHOT: WireAlbumProtocolSnapshot = {
  anchor: null,
  records: [],
  tombstones: [],
  envelopes: [],
  recoveryEnvelopes: [],
};

// ── snapshot ─────────────────────────────────────────────────────────────

export const getAlbumProtocolSnapshotProgram = (
  userId: string
): Effect.Effect<WireAlbumProtocolSnapshot, InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return EMPTY_SNAPSHOT;
    }

    const anchorRow = yield* one<{ payload: string }>(
      'select payload from album_trust_anchors where space_id = ?',
      spaceId
    );
    const recordRows = yield* all<{ payload: string }>(
      'select payload from album_device_records where space_id = ? order by device_id asc',
      spaceId
    );
    const tombstoneRows = yield* all<{ payload: string }>(
      'select payload from album_device_tombstones where space_id = ? order by created_at asc, id asc',
      spaceId
    );
    const envelopeRows = yield* all<{ payload: string }>(
      `select payload from album_space_key_envelopes where space_id = ?
        order by generation asc, recipient_device_id asc, recipient_revision asc`,
      spaceId
    );
    const recoveryRows = yield* all<{ payload: string }>(
      'select payload from album_recovery_envelopes where space_id = ? order by generation asc',
      spaceId
    );

    return {
      anchor: anchorRow ? yield* readPayload(wireSpaceTrustAnchorSchema, anchorRow.payload) : null,
      records: yield* Effect.forEach(recordRows, (row) => readPayload(wireDeviceRecordSchema, row.payload)),
      tombstones: yield* Effect.forEach(tombstoneRows, (row) =>
        readPayload(wireDeviceTombstoneSchema, row.payload)
      ),
      envelopes: yield* Effect.forEach(envelopeRows, (row) =>
        readPayload(wireSpaceKeyEnvelopeSchema, row.payload)
      ),
      recoveryEnvelopes: yield* Effect.forEach(recoveryRows, (row) =>
        readPayload(wireRecoveryEnvelopeSchema, row.payload)
      ),
    };
  });

// ── the trust anchor ─────────────────────────────────────────────────────

/**
 * Create-only, and only by the Space's creator.
 *
 * Not because that makes the anchor cryptographically trustworthy, and not
 * because the server can tell a good anchor from a bad one. It stops an
 * ordinary client from casually replacing or bootstrap-racing the row. A
 * malicious server can still lie, which the threat model already accepts.
 *
 * A repeat of the identical anchor returns it rather than failing, so a retry
 * is not an error.
 */
export const putAlbumTrustAnchorProgram = (
  userId: string,
  input: unknown
): Effect.Effect<
  WireSpaceTrustAnchor,
  BadRequestError | ForbiddenError | ConflictError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const parsed = wireSpaceTrustAnchorSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid trust anchor'));
    }
    const anchor = parsed.data;

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to publish an anchor'));
    }
    if (anchor.spaceId !== spaceId) {
      return yield* Effect.fail(forbidden('That anchor belongs to another Space'));
    }
    if (!(yield* isSpaceCreator(spaceId, userId))) {
      return yield* Effect.fail(forbidden('Only the Space creator can publish its trust anchor'));
    }

    const at = yield* nowMs;
    yield* execute(
      `insert into album_trust_anchors (space_id, payload, created_at) values (?, ?, ?)
       on conflict(space_id) do nothing`,
      spaceId,
      JSON.stringify(anchor),
      at
    );

    const stored = yield* one<{ payload: string }>(
      'select payload from album_trust_anchors where space_id = ?',
      spaceId
    );
    if (!stored) {
      return yield* Effect.fail(new InternalError({}));
    }
    const persisted = yield* readPayload(wireSpaceTrustAnchorSchema, stored.payload);
    if (!samePayload(persisted, anchor)) {
      return yield* Effect.fail(conflict('That Space already has a trust anchor'));
    }
    return persisted;
  });

// ── device records ───────────────────────────────────────────────────────

/**
 * One row, one account owner.
 *
 * The first write of a `deviceId` claims the row for the authenticated user and
 * every later revision has to come from that same account. That is the fix for
 * the hole the shared backup had, where either member could rewrite the other's
 * device rows. The server still does not judge the signature; it only refuses to
 * let one member's account mutate the other member's rows.
 *
 * The revision condition lives in the write itself rather than in a read
 * followed by a check, because that read-then-write is a race.
 */
export const putAlbumDeviceRecordProgram = (
  userId: string,
  deviceId: string,
  input: unknown
): Effect.Effect<
  WireDeviceRecord,
  BadRequestError | ForbiddenError | ConflictError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const parsed = wireDeviceRecordSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid device record'));
    }
    const record = parsed.data;

    if (record.deviceId !== deviceId) {
      return yield* Effect.fail(badRequest('That record is for a different device'));
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to enrol a device'));
    }
    if (record.spaceId !== spaceId) {
      return yield* Effect.fail(forbidden('That device belongs to another Space'));
    }

    const owner = yield* deviceOwner(spaceId, deviceId);
    if (owner !== null && owner !== userId) {
      return yield* Effect.fail(forbidden('That device belongs to your partner'));
    }

    const at = yield* nowMs;
    const written = yield* execute(
      `insert into album_device_records (space_id, device_id, owner_user_id, revision, payload, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(space_id, device_id) do update set
         revision = excluded.revision,
         payload = excluded.payload,
         updated_at = excluded.updated_at
       where album_device_records.owner_user_id = excluded.owner_user_id
         and album_device_records.revision < excluded.revision`,
      spaceId,
      deviceId,
      userId,
      record.revision,
      JSON.stringify(record),
      at
    );
    if (written.changes === 0) {
      return yield* Effect.fail(
        conflict('That device record is not newer than the one already stored')
      );
    }
    return record;
  });

// ── device tombstones ────────────────────────────────────────────────────

/**
 * Append-only, one row per tombstone rather than one per target.
 *
 * A single row per target with last-write-wins would let an untrusted tombstone
 * displace a valid one, and the client has logic specifically to evaluate each
 * tombstone's authority. It gets all of them.
 */
export const postAlbumDeviceTombstoneProgram = (
  userId: string,
  input: unknown
): Effect.Effect<
  WireDeviceTombstone,
  BadRequestError | ForbiddenError | InternalError,
  DbService | ClockService | IdService
> =>
  Effect.gen(function* () {
    const parsed = wireDeviceTombstoneSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid device tombstone'));
    }
    const tombstone = parsed.data;

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to revoke a device'));
    }
    if (tombstone.spaceId !== spaceId) {
      return yield* Effect.fail(forbidden('That tombstone belongs to another Space'));
    }

    const revoker = tombstone.revokedBy;
    if (revoker.kind === 'device') {
      if (revoker.deviceId === tombstone.targetDeviceId) {
        return yield* Effect.fail(badRequest('A device cannot revoke itself'));
      }
      const owner = yield* deviceOwner(spaceId, revoker.deviceId);
      if (owner === null) {
        return yield* Effect.fail(forbidden('That device is not registered in this Space'));
      }
      if (owner !== userId) {
        return yield* Effect.fail(forbidden('You do not own the device that revoked'));
      }
    }
    // A recovery-authored tombstone has no account-owned signing device to check.
    // Active membership, the schema, and the rate limit are all the server can
    // legitimately enforce; the client decides whether the signature is good.

    const id = yield* newId;
    const at = yield* nowMs;
    yield* execute(
      `insert into album_device_tombstones (id, space_id, target_device_id, payload, created_at)
       values (?, ?, ?, ?, ?)`,
      id,
      spaceId,
      tombstone.targetDeviceId,
      JSON.stringify(tombstone),
      at
    );
    return tombstone;
  });

// ── space key envelopes ──────────────────────────────────────────────────

/**
 * The authoriser writes, so the ownership direction is the opposite of a device
 * record: the caller has to own `authoriserDeviceId`, not the recipient.
 *
 * Only structural facts are checked. Whether the authoriser was allowed to
 * authorise is a question for the client's trust walker, and the server cannot
 * answer it.
 *
 * Immutable at (space, generation, recipient, recipient revision), because the
 * envelope binds the recipient's revision. A reparented device needs a new row.
 */
export const putAlbumSpaceKeyEnvelopeProgram = (
  userId: string,
  input: unknown
): Effect.Effect<
  WireSpaceKeyEnvelope,
  BadRequestError | ForbiddenError | ConflictError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const parsed = wireSpaceKeyEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid space key envelope'));
    }
    const envelope = parsed.data;

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to seal a key'));
    }
    if (envelope.spaceId !== spaceId) {
      return yield* Effect.fail(forbidden('That envelope belongs to another Space'));
    }

    const authoriserOwner = yield* deviceOwner(spaceId, envelope.authoriserDeviceId);
    if (authoriserOwner === null) {
      return yield* Effect.fail(badRequest('The authorising device is not registered in this Space'));
    }
    if (authoriserOwner !== userId) {
      return yield* Effect.fail(forbidden('You do not own the authorising device'));
    }

    const recipient = yield* deviceOwner(spaceId, envelope.recipientDeviceId);
    if (recipient === null) {
      return yield* Effect.fail(badRequest('The recipient device is not registered in this Space'));
    }

    const at = yield* nowMs;
    yield* execute(
      `insert into album_space_key_envelopes
         (space_id, generation, recipient_device_id, recipient_revision, authoriser_device_id, payload, created_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict(space_id, generation, recipient_device_id, recipient_revision) do nothing`,
      spaceId,
      envelope.generation,
      envelope.recipientDeviceId,
      envelope.recipientRevision,
      envelope.authoriserDeviceId,
      JSON.stringify(envelope),
      at
    );

    const stored = yield* one<{ payload: string }>(
      `select payload from album_space_key_envelopes
        where space_id = ? and generation = ? and recipient_device_id = ? and recipient_revision = ?`,
      spaceId,
      envelope.generation,
      envelope.recipientDeviceId,
      envelope.recipientRevision
    );
    if (!stored) {
      return yield* Effect.fail(new InternalError({}));
    }
    const persisted = yield* readPayload(wireSpaceKeyEnvelopeSchema, stored.payload);
    if (!samePayload(persisted, envelope)) {
      return yield* Effect.fail(conflict('That device already has an envelope at this revision'));
    }
    return persisted;
  });

// ── recovery envelopes ───────────────────────────────────────────────────

/**
 * One immutable row per (space, generation).
 *
 * Generation 1 is cut when the Space is created, so only the creator may write
 * it: otherwise a member could race the creator and occupy the row with
 * something the phrase does not open. Later generations have no such owner, and
 * active membership is all the server can fairly require.
 */
export const putAlbumRecoveryEnvelopeProgram = (
  userId: string,
  generation: number,
  input: unknown
): Effect.Effect<
  WireRecoveryEnvelope,
  BadRequestError | ForbiddenError | ConflictError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const parsed = wireRecoveryEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid recovery envelope'));
    }
    const envelope = parsed.data;

    if (envelope.generation !== generation) {
      return yield* Effect.fail(badRequest('That envelope is for a different generation'));
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to seal a recovery key'));
    }
    if (envelope.spaceId !== spaceId) {
      return yield* Effect.fail(forbidden('That envelope belongs to another Space'));
    }
    if (generation === 1 && !(yield* isSpaceCreator(spaceId, userId))) {
      return yield* Effect.fail(forbidden('Only the Space creator can cut the first recovery envelope'));
    }

    const at = yield* nowMs;
    yield* execute(
      `insert into album_recovery_envelopes (space_id, generation, payload, created_at)
       values (?, ?, ?, ?)
       on conflict(space_id, generation) do nothing`,
      spaceId,
      generation,
      JSON.stringify(envelope),
      at
    );

    const stored = yield* one<{ payload: string }>(
      'select payload from album_recovery_envelopes where space_id = ? and generation = ?',
      spaceId,
      generation
    );
    if (!stored) {
      return yield* Effect.fail(new InternalError({}));
    }
    const persisted = yield* readPayload(wireRecoveryEnvelopeSchema, stored.payload);
    if (!samePayload(persisted, envelope)) {
      return yield* Effect.fail(conflict('That generation already has a recovery envelope'));
    }
    return persisted;
  });
