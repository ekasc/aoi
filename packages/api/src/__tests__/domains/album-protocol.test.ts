import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import {
  PROTOCOL_MAX_COUNTER,
  PROTOCOL_MEDIA_TOMBSTONE_BASE,
  PROTOCOL_MEDIA_TOMBSTONES_PER_MEDIA,
  encodeBase64,
} from '@aoi/shared';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  albumMediaKey,
  finalizeAlbumMediaProgram,
  reserveAlbumMediaProgram,
} from '../../domains/album';
import {
  getAlbumMediaProtocolProgram,
  getAlbumProtocolSnapshotProgram,
  postAlbumDeviceTombstoneProgram,
  postAlbumMediaTombstoneProgram,
  putAlbumDeviceClaimProgram,
  putAlbumDeviceRecordProgram,
  putAlbumMediaManifestProgram,
  putAlbumRecoveryEnvelopeProgram,
  putAlbumSpaceKeyEnvelopeProgram,
  putAlbumTrustAnchorProgram,
} from '../../domains/album-protocol';
import { BadRequestError, ConflictError, ForbiddenError } from '../../domains/errors';

/**
 * The protocol's server side is storage and authority, not cryptography. These
 * tests are about who may write which row, and about revisions only moving
 * forward. Whether a signature is good is the client's question and is tested
 * there.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const OTHER_SPACE = '00000000-0000-4000-8000-000000000020';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');
const AT = '2026-01-15T00:00:00.000Z';

const KEY = encodeBase64(new Uint8Array(32).fill(1));
const SIG = encodeBase64(new Uint8Array(64).fill(2));
const NONCE = encodeBase64(new Uint8Array(12).fill(3));
const WRAPPED = encodeBase64(new Uint8Array(48).fill(4));

const anchor = (overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  rootDeviceId: 'device-root',
  rootSigningPublicKey: KEY,
  recoverySigningPublicKey: KEY,
  createdAt: AT,
  rootSignature: SIG,
  recoverySignature: SIG,
  ...overrides,
});

const record = (deviceId: string, overrides: Record<string, unknown> = {}) => ({
  deviceId,
  spaceId: SPACE_1,
  signingPublicKey: KEY,
  agreementPublicKey: KEY,
  authorisedBy: { kind: 'self' },
  revision: 1,
  createdAt: AT,
  authorisation: SIG,
  ...overrides,
});

const tombstone = (targetDeviceId: string, overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  targetDeviceId,
  revision: 2,
  revokedBy: { kind: 'device', deviceId: 'device-a' },
  revokedAt: AT,
  signature: SIG,
  ...overrides,
});

const envelope = (overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  generation: 1,
  recipientDeviceId: 'device-b',
  authoriserDeviceId: 'device-a',
  recipientRevision: 1,
  nonce: NONCE,
  ciphertext: WRAPPED,
  ...overrides,
});

const recoveryEnvelope = (overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  generation: 1,
  nonce: NONCE,
  ciphertext: WRAPPED,
  ...overrides,
});

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    T0,
    T0
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    T0,
    T0
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    id,
    creatorId,
    T0
  );
}

function insertPartner(d1: ShimD1, spaceId: string, userId: string): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)`,
    spaceId,
    userId,
    T0
  );
}

function makeCtx() {
  const harness = makeTestHarness();
  return {
    harness,
    provide: <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.provide(program as Effect.Effect<A, E, never>, harness.layer as never) as Effect.Effect<A, E, never>,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

async function failureOf<A>(effect: Effect.Effect<A, unknown, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(effect as Effect.Effect<A, unknown, never>));
  if (Exit.isSuccess(exit)) {
    throw new Error('expected program to fail, but it succeeded');
  }
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) {
    return cause.error;
  }
  throw new Error(`expected a typed failure, got ${cause._tag}`);
}

/** A Space with both members, and nothing else written yet. */
function couple() {
  const ctx = makeCtx();
  insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
  insertSpace(ctx.harness.d1, SPACE_1, USER_A);
  insertPartner(ctx.harness.d1, SPACE_1, USER_B);
  return ctx;
}

describe('the trust anchor', () => {
  it('is written once by the creator, and read back in the snapshot', async () => {
    const ctx = couple();
    const written = await run(ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor())));
    expect(written.spaceId).toBe(SPACE_1);

    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.anchor).toEqual(anchor());
  });

  it('returns the same anchor on an identical retry rather than failing', async () => {
    const ctx = couple();
    await run(ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor())));
    expect(await run(ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor())))).toEqual(anchor());
  });

  it('refuses to replace it with a different one', async () => {
    const ctx = couple();
    await run(ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor())));
    const err = await failureOf(
      ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor({ rootDeviceId: 'device-other' })))
    );
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('refuses a member who did not create the Space', async () => {
    const ctx = couple();
    const err = await failureOf(ctx.provide(putAlbumTrustAnchorProgram(USER_B, anchor())));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses an anchor for another Space', async () => {
    const ctx = couple();
    const err = await failureOf(
      ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor({ spaceId: OTHER_SPACE })))
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a malformed anchor', async () => {
    const ctx = couple();
    const err = await failureOf(ctx.provide(putAlbumTrustAnchorProgram(USER_A, { spaceId: SPACE_1 })));
    expect(err).toBeInstanceOf(BadRequestError);
  });
});

/**
 * Claim, then enrol. The claim is what fixes the row's owner, so every test
 * that wants a real device goes through both steps.
 */
const enrolProgram = (userId: string, deviceId: string, wire: ReturnType<typeof record>) =>
  Effect.gen(function* () {
    yield* putAlbumDeviceClaimProgram(userId, {
      deviceId,
      signingPublicKey: wire.signingPublicKey,
      agreementPublicKey: wire.agreementPublicKey,
    });
    return yield* putAlbumDeviceRecordProgram(userId, deviceId, wire);
  });


describe('device records', () => {
  it('lets the first writer claim the row, and only that account revise it', async () => {
    const ctx = couple();
    const first = await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    expect(first.revision).toBe(1);

    const bumped = await run(
      ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a', { revision: 2 })))
    );
    expect(bumped.revision).toBe(2);

    // The partner cannot touch it, which is the hole the backup blob had.
    const err = await failureOf(
      ctx.provide(putAlbumDeviceRecordProgram(USER_B, 'device-a', record('device-a', { revision: 3 })))
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('lets each member own their own devices', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    const theirs = await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    expect(theirs.deviceId).toBe('device-b');

    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.records.map((entry) => entry.deviceId).sort()).toEqual(['device-a', 'device-b']);
  });

  it('refuses an equal or lower revision', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a', { revision: 2 }))));

    for (const revision of [2, 1]) {
      const err = await failureOf(
        ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a', { revision })))
      );
      expect(err).toBeInstanceOf(ConflictError);
    }
  });

  it('refuses a record whose device does not match the path', async () => {
    const ctx = couple();
    const err = await failureOf(
      ctx.provide(putAlbumDeviceRecordProgram(USER_A, 'device-a', record('device-b')))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a record for another Space', async () => {
    const ctx = couple();
    const err = await failureOf(
      ctx.provide(putAlbumDeviceRecordProgram(USER_A, 'device-a', record('device-a', { spaceId: OTHER_SPACE })))
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });
});

describe('device tombstones', () => {
  it('accepts one from the owner of the revoking device', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    const posted = await run(
      ctx.provide(
        postAlbumDeviceTombstoneProgram(
          USER_A,
          tombstone('device-b', { revokedBy: { kind: 'device', deviceId: 'device-a' } })
        )
      )
    );
    expect(posted.targetDeviceId).toBe('device-b');
  });

  it('refuses one from a member who does not own the revoking device', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    const err = await failureOf(
      ctx.provide(
        postAlbumDeviceTombstoneProgram(
          USER_B,
          tombstone('device-b', { revokedBy: { kind: 'device', deviceId: 'device-a' } })
        )
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a revoker that is not registered', async () => {
    const ctx = couple();
    const err = await failureOf(
      ctx.provide(
        postAlbumDeviceTombstoneProgram(
          USER_A,
          tombstone('device-b', { revokedBy: { kind: 'device', deviceId: 'device-ghost' } })
        )
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a device revoking itself', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    const err = await failureOf(
      ctx.provide(
        postAlbumDeviceTombstoneProgram(
          USER_A,
          tombstone('device-a', { revokedBy: { kind: 'device', deviceId: 'device-a' } })
        )
      )
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('accepts a recovery-authored tombstone from any member', async () => {
    const ctx = couple();
    const posted = await run(
      ctx.provide(
        postAlbumDeviceTombstoneProgram(USER_B, tombstone('device-a', { revokedBy: { kind: 'recovery' } }))
      )
    );
    expect(posted.revokedBy).toEqual({ kind: 'recovery' });
  });

  it('keeps every tombstone rather than one row per target', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    const revoker = { kind: 'device' as const, deviceId: 'device-a' };
    await run(ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, tombstone('device-b', { revision: 2, revokedBy: revoker }))));
    await run(ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, tombstone('device-b', { revision: 3, revokedBy: revoker }))));

    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.tombstones).toHaveLength(2);
    // The client evaluates each one's authority, so it needs all of them.
    expect(snapshot.tombstones.map((entry) => entry.revision).sort()).toEqual([2, 3]);
  });
});

describe('space key envelopes', () => {
  async function withTwoDevices() {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    return ctx;
  }

  it('is written by the owner of the authorising device', async () => {
    const ctx = await withTwoDevices();
    const written = await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope())));
    expect(written.recipientDeviceId).toBe('device-b');
  });

  it('refuses a member who does not own the authorising device', async () => {
    const ctx = await withTwoDevices();
    const err = await failureOf(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_B, envelope())));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses an envelope for a recipient that is not registered', async () => {
    const ctx = await withTwoDevices();
    const err = await failureOf(
      ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope({ recipientDeviceId: 'device-ghost' })))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('is immutable at the recipient revision, and a reparenting is a new row', async () => {
    const ctx = await withTwoDevices();
    await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope())));
    expect(await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope())))).toEqual(envelope());

    const different = envelope({ ciphertext: encodeBase64(new Uint8Array(48).fill(9)) });
    const err = await failureOf(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, different)));
    expect(err).toBeInstanceOf(ConflictError);

    await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope({ recipientRevision: 2 }))));
    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.envelopes.map((entry) => entry.recipientRevision).sort()).toEqual([1, 2]);
  });
});

describe('recovery envelopes', () => {
  it('takes generation 1 from the creator only', async () => {
    const ctx = couple();
    const written = await run(
      ctx.provide(putAlbumRecoveryEnvelopeProgram(USER_A, 1, recoveryEnvelope()))
    );
    expect(written.generation).toBe(1);

    const err = await failureOf(
      ctx.provide(
        putAlbumRecoveryEnvelopeProgram(USER_B, 1, recoveryEnvelope({ ciphertext: encodeBase64(new Uint8Array(48).fill(7)) }))
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses any generation but the first', async () => {
    const ctx = couple();
    // Rotation is not implemented, and a create-only slot that any member could
    // claim is a slot any member could permanently waste.
    const err = await failureOf(
      ctx.provide(putAlbumRecoveryEnvelopeProgram(USER_B, 2, recoveryEnvelope({ generation: 2 })))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses an envelope whose generation does not match the path', async () => {
    const ctx = couple();
    const err = await failureOf(
      ctx.provide(putAlbumRecoveryEnvelopeProgram(USER_A, 2, recoveryEnvelope({ generation: 1 })))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('is create-only per generation', async () => {
    const ctx = couple();
    await run(ctx.provide(putAlbumRecoveryEnvelopeProgram(USER_A, 1, recoveryEnvelope())));
    const err = await failureOf(
      ctx.provide(
        putAlbumRecoveryEnvelopeProgram(USER_A, 1, recoveryEnvelope({ ciphertext: encodeBase64(new Uint8Array(48).fill(8)) }))
      )
    );
    expect(err).toBeInstanceOf(ConflictError);
  });
});

describe('the snapshot', () => {
  it('is empty for a Space with nothing written', async () => {
    const ctx = couple();
    expect(await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)))).toEqual({
      anchor: null,
      records: [],
      claims: [],
      offers: [],
      tombstones: [],
      envelopes: [],
      recoveryEnvelopes: [],
    });
  });

  it('is empty for a user with no active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    expect(await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)))).toEqual({
      anchor: null,
      records: [],
      claims: [],
      offers: [],
      tombstones: [],
      envelopes: [],
      recoveryEnvelopes: [],
    });
  });

  it('scopes to the active Space', async () => {
    const ctx = couple();
    // A user has one active Space, so scoping is proved with a second account
    // in a second Space rather than a second Space for the same account.
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, OTHER_SPACE, USER_C);

    await run(ctx.provide(putAlbumTrustAnchorProgram(USER_A, anchor())));
    await run(ctx.provide(putAlbumTrustAnchorProgram(USER_C, anchor({ spaceId: OTHER_SPACE }))));

    const mine = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    const theirs = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_C)));
    expect(mine.anchor?.spaceId).toBe(SPACE_1);
    expect(theirs.anchor?.spaceId).toBe(OTHER_SPACE);
  });
});

describe('device claims', () => {
  it('claims an id for the account that made the claim', async () => {
    const ctx = couple();
    const claimed = await run(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_A, { deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    expect(claimed.deviceId).toBe('device-a');
    expect(claimed.spaceId).toBe(SPACE_1);
  });

  it('is idempotent for the same owner and keys', async () => {
    const ctx = couple();
    const body = { deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY };
    const first = await run(ctx.provide(putAlbumDeviceClaimProgram(USER_A, body)));
    const again = await run(ctx.provide(putAlbumDeviceClaimProgram(USER_A, body)));
    expect(again).toEqual(first);
  });

  it('refuses the partner claiming the same id', async () => {
    const ctx = couple();
    const body = { deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY };
    await run(ctx.provide(putAlbumDeviceClaimProgram(USER_A, body)));
    const err = await failureOf(ctx.provide(putAlbumDeviceClaimProgram(USER_B, body)));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses different keys for an id already claimed', async () => {
    const ctx = couple();
    await run(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_A, { deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    const other = encodeBase64(new Uint8Array(32).fill(9));
    const err = await failureOf(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_A, { deviceId: 'device-a', signingPublicKey: other, agreementPublicKey: other })
      )
    );
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('is required before a record can be written', async () => {
    const ctx = couple();
    const err = await failureOf(ctx.provide(putAlbumDeviceRecordProgram(USER_A, 'device-a', record('device-a'))));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('stops the authoriser enrolling the recipient device for it', async () => {
    const ctx = couple();
    // Bob claims his own phone. Alice authorised it, so she knows its id and
    // keys; this is the request that used to take the row.
    await run(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_B, { deviceId: 'device-b', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    const err = await failureOf(ctx.provide(putAlbumDeviceRecordProgram(USER_A, 'device-b', record('device-b'))));
    expect(err).toBeInstanceOf(ForbiddenError);

    // And Bob can still write his own.
    const his = await run(ctx.provide(putAlbumDeviceRecordProgram(USER_B, 'device-b', record('device-b'))));
    expect(his.deviceId).toBe('device-b');
  });

  it('refuses a record whose keys do not match the claim', async () => {
    const ctx = couple();
    await run(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_A, { deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    const other = encodeBase64(new Uint8Array(32).fill(9));
    const err = await failureOf(
      ctx.provide(putAlbumDeviceRecordProgram(USER_A, 'device-a', record('device-a', { signingPublicKey: other })))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('is bounded, because a claimed id that is never enrolled is still a row', async () => {
    const ctx = couple();
    for (let index = 0; index < 32; index += 1) {
      ctx.harness.d1.runSync(
        `insert into album_device_claims
           (space_id, device_id, owner_user_id, signing_public_key, agreement_public_key, created_at)
         values (?, ?, ?, ?, ?, ?)`,
        SPACE_1,
        `claimed-${index}`,
        USER_A,
        KEY,
        KEY,
        T0
      );
    }
    const err = await failureOf(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_A, { deviceId: 'one-more', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    expect(err).toBeInstanceOf(ConflictError);
  });
});

describe('the envelope key keeps every candidate', () => {
  it('lets a second authoriser store its own envelope for the same recipient revision', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a1', record('device-a1'))));
    await run(ctx.provide(enrolProgram(USER_A, 'device-a2', record('device-a2'))));
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));

    const first = envelope({ authoriserDeviceId: 'device-a1' });
    const second = envelope({
      authoriserDeviceId: 'device-a2',
      ciphertext: encodeBase64(new Uint8Array(48).fill(6)),
    });
    await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, first)));
    // Under the old key this was a conflict, so a wrong envelope could occupy
    // the slot permanently and the real authoriser could never store one.
    await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, second)));

    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.envelopes.map((entry) => entry.authoriserDeviceId).sort()).toEqual([
      'device-a1',
      'device-a2',
    ]);
  });
});

describe('the ceilings', () => {
  it('stops at the tombstone limit rather than growing a snapshot forever', async () => {
    const ctx = couple();
    for (let index = 0; index < 256; index += 1) {
      ctx.harness.d1.runSync(
        `insert into album_device_tombstones (id, space_id, target_device_id, payload, created_at)
         values (?, ?, ?, ?, ?)`,
        `t-${index}`,
        SPACE_1,
        `target-${index}`,
        `payload-${index}`,
        T0
      );
    }
    const err = await failureOf(
      ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, tombstone('device-b', { revokedBy: { kind: 'recovery' } })))
    );
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('stops at the envelope limit', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    for (let index = 0; index < 256; index += 1) {
      ctx.harness.d1.runSync(
        `insert into album_space_key_envelopes
           (space_id, generation, recipient_device_id, recipient_revision, authoriser_device_id, payload, created_at)
         values (?, 1, ?, ?, ?, ?, ?)`,
        SPACE_1,
        'device-b',
        index + 1,
        'device-a',
        `payload-${index}`,
        T0
      );
    }
    const err = await failureOf(
      ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, envelope({ recipientRevision: 999 })))
    );
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('keeps an exact tombstone retry idempotent rather than growing', async () => {
    const ctx = couple();
    const body = tombstone('device-b', { revokedBy: { kind: 'recovery' } });
    await run(ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, body)));
    await run(ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, body)));

    const snapshot = await run(ctx.provide(getAlbumProtocolSnapshotProgram(USER_A)));
    expect(snapshot.tombstones).toHaveLength(1);
  });
});

/**
 * The ceiling and the answer both live in the write, so what is stored decides
 * what the caller is told. These are the cases a separate count would get
 * wrong.
 */
describe('the write is the check', () => {
  it('tells the truth when the other member won the claim insert race', async () => {
    const ctx = couple();
    // Alice's row is already there, as though she inserted it a moment before
    // Bob's request arrived. A pre-read would have seen nothing and reported
    // success for a claim Bob does not own.
    ctx.harness.d1.runSync(
      `insert into album_device_claims
         (space_id, device_id, owner_user_id, signing_public_key, agreement_public_key, created_at)
       values (?, ?, ?, ?, ?, ?)`,
      SPACE_1,
      'device-b',
      USER_A,
      KEY,
      KEY,
      T0
    );

    const err = await failureOf(
      ctx.provide(
        putAlbumDeviceClaimProgram(USER_B, { deviceId: 'device-b', signingPublicKey: KEY, agreementPublicKey: KEY })
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('still succeeds for an exact tombstone retry at the ceiling', async () => {
    const ctx = couple();
    const body = tombstone('device-b', { revokedBy: { kind: 'recovery' } });
    for (let index = 0; index < 255; index += 1) {
      ctx.harness.d1.runSync(
        `insert into album_device_tombstones (id, space_id, target_device_id, payload, created_at)
         values (?, ?, ?, ?, ?)`,
        `t-${index}`,
        SPACE_1,
        `target-${index}`,
        `payload-${index}`,
        T0
      );
    }
    // The 256th row is the one this request is about to repeat.
    ctx.harness.d1.runSync(
      `insert into album_device_tombstones (id, space_id, target_device_id, payload, created_at)
       values (?, ?, ?, ?, ?)`,
      't-existing',
      SPACE_1,
      'device-b',
      JSON.stringify(body),
      T0
    );

    // No new object may be created, and this request creates none.
    expect(await run(ctx.provide(postAlbumDeviceTombstoneProgram(USER_A, body)))).toEqual(body);
  });

  it('still succeeds for an existing envelope at the ceiling', async () => {
    const ctx = couple();
    await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));

    const body = envelope();
    for (let index = 0; index < 255; index += 1) {
      ctx.harness.d1.runSync(
        `insert into album_space_key_envelopes
           (space_id, generation, recipient_device_id, recipient_revision, authoriser_device_id, payload, created_at)
         values (?, 1, ?, ?, ?, ?, ?)`,
        SPACE_1,
        'device-b',
        index + 100,
        'device-a',
        `payload-${index}`,
        T0
      );
    }
    ctx.harness.d1.runSync(
      `insert into album_space_key_envelopes
         (space_id, generation, recipient_device_id, recipient_revision, authoriser_device_id, payload, created_at)
       values (?, 1, ?, ?, ?, ?, ?)`,
      SPACE_1,
      'device-b',
      1,
      'device-a',
      JSON.stringify(body),
      T0
    );

    expect(await run(ctx.provide(putAlbumSpaceKeyEnvelopeProgram(USER_A, body)))).toEqual(body);
  });
});

/**
 * Media manifests and tombstones. The server stores signed objects it cannot
 * verify; these tests are about the structural facts it *can* enforce — who owns
 * the row, that the media is a finalised reservation, and that nothing a
 * tombstone says can destroy anything.
 */

const MANIFEST_SIZE = 3;
const MEDIA_1 = '00000000-0000-4000-8000-000000000101';
const MEDIA_2 = '00000000-0000-4000-8000-000000000102';

const manifest = (mediaId: string, overrides: Record<string, unknown> = {}) => ({
  mediaId,
  spaceId: SPACE_1,
  generation: 1,
  revision: 1,
  wrappedKey: { nonce: NONCE, ciphertext: WRAPPED },
  sealedNonce: NONCE,
  byteLength: MANIFEST_SIZE,
  mimeType: 'image/jpeg',
  uploaderDeviceId: 'device-a',
  createdAt: AT,
  signature: SIG,
  ...overrides,
});

const mediaTombstone = (mediaId: string, overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  mediaId,
  revision: 2,
  deletedAt: AT,
  deletedByDeviceId: 'device-a',
  signature: SIG,
  ...overrides,
});

/** A couple with the uploader device enrolled for USER_A. */
async function withUploader() {
  const ctx = couple();
  await run(ctx.provide(enrolProgram(USER_A, 'device-a', record('device-a'))));
  return ctx;
}

function seedSealed(ctx: ReturnType<typeof couple>, mediaId: string, size: number): void {
  ctx.harness.r2.putSync(
    albumMediaKey(SPACE_1, mediaId),
    new Uint8Array(size).fill(9),
    'application/octet-stream'
  );
}

/** Reserve and finalise one media, so it is a real completed upload. */
async function completedMedia(
  ctx: ReturnType<typeof couple>,
  mediaId: string,
  byteLength = MANIFEST_SIZE
) {
  await run(
    ctx.provide(
      reserveAlbumMediaProgram(USER_A, {
        mediaId,
        generation: 1,
        uploaderDeviceId: 'device-a',
        byteLength,
      })
    )
  );
  seedSealed(ctx, mediaId, byteLength);
  await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, mediaId)));
}

function manifestEffect(
  ctx: ReturnType<typeof couple>,
  mediaId: string,
  overrides: Record<string, unknown> = {},
  userId = USER_A
) {
  return ctx.provide(putAlbumMediaManifestProgram(userId, mediaId, manifest(mediaId, overrides)));
}

async function publishManifest(
  ctx: ReturnType<typeof couple>,
  mediaId: string,
  overrides: Record<string, unknown> = {},
  userId = USER_A
) {
  return run(manifestEffect(ctx, mediaId, overrides, userId));
}

describe('media manifests', () => {
  it('stores an immutable manifest for a finalised upload and reads it back', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    const written = await publishManifest(ctx, MEDIA_1);
    expect(written.mediaId).toBe(MEDIA_1);

    const read = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)));
    expect(read.manifests).toEqual([manifest(MEDIA_1)]);
    expect(read.nextCursor).toBeNull();
  });

  it('returns the same manifest on an identical retry', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    expect(await publishManifest(ctx, MEDIA_1)).toEqual(manifest(MEDIA_1));
  });

  it('refuses a different payload for the same media rather than overwriting it', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    const err = await failureOf(manifestEffect(ctx, MEDIA_1, { revision: 2 }));
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('refuses a manifest for media that was never reserved', async () => {
    const ctx = await withUploader();
    const err = await failureOf(manifestEffect(ctx, MEDIA_1));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a manifest before the upload is finalised', async () => {
    const ctx = await withUploader();
    await run(
      ctx.provide(
        reserveAlbumMediaProgram(USER_A, {
          mediaId: MEDIA_1,
          generation: 1,
          uploaderDeviceId: 'device-a',
          byteLength: MANIFEST_SIZE,
        })
      )
    );
    const err = await failureOf(manifestEffect(ctx, MEDIA_1));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a manifest that disagrees with the reservation', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);

    // A declared length that is not the reserved one.
    expect(
      await failureOf(manifestEffect(ctx, MEDIA_1, { byteLength: MANIFEST_SIZE + 1 }))
    ).toBeInstanceOf(BadRequestError);
    // A generation that is not the reserved one.
    expect(await failureOf(manifestEffect(ctx, MEDIA_1, { generation: 2 }))).toBeInstanceOf(
      BadRequestError
    );
    // A different uploading device, one the caller does own.
    await run(ctx.provide(enrolProgram(USER_A, 'device-a2', record('device-a2'))));
    expect(
      await failureOf(manifestEffect(ctx, MEDIA_1, { uploaderDeviceId: 'device-a2' }))
    ).toBeInstanceOf(BadRequestError);
  });

  it('refuses a manifest for another Space', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    const err = await failureOf(manifestEffect(ctx, MEDIA_1, { spaceId: OTHER_SPACE }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a manifest whose uploader device the caller does not own', async () => {
    const ctx = await withUploader();
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    const err = await failureOf(manifestEffect(ctx, MEDIA_1, { uploaderDeviceId: 'device-b' }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a manifest signed by a device that is not registered', async () => {
    const ctx = await withUploader();
    const err = await failureOf(
      manifestEffect(ctx, MEDIA_1, { uploaderDeviceId: 'device-ghost' })
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a manifest whose mediaId does not match the path', async () => {
    const ctx = await withUploader();
    const err = await failureOf(
      ctx.provide(putAlbumMediaManifestProgram(USER_A, MEDIA_2, manifest(MEDIA_1)))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a malformed manifest', async () => {
    const ctx = await withUploader();
    const err = await failureOf(
      ctx.provide(putAlbumMediaManifestProgram(USER_A, MEDIA_1, { mediaId: MEDIA_1 }))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a member who has been removed', async () => {
    const ctx = await withUploader();
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    ctx.harness.d1.runSync(
      `update space_members set state = 'left' where space_id = ? and user_id = ?`,
      SPACE_1,
      USER_B
    );
    const err = await failureOf(
      manifestEffect(ctx, MEDIA_1, { uploaderDeviceId: 'device-b' }, USER_B)
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('pages manifests deterministically and never hides that more exist', async () => {
    const ctx = await withUploader();
    for (const mediaId of [MEDIA_1, MEDIA_2]) {
      await completedMedia(ctx, mediaId);
      await publishManifest(ctx, mediaId);
    }

    const first = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A, { limit: 1 })));
    expect(first.manifests).toHaveLength(1);
    expect(first.nextCursor).toBe(MEDIA_1);

    const second = await run(
      ctx.provide(
        getAlbumMediaProtocolProgram(USER_A, { cursor: first.nextCursor ?? '', limit: 1 })
      )
    );
    expect(second.manifests.map((entry) => entry.mediaId)).toEqual([MEDIA_2]);
    expect(second.nextCursor).toBeNull();
  });
});

describe('media tombstones', () => {
  it('stores a candidate and leaves the manifest and ciphertext untouched', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);

    const written = await run(
      ctx.provide(postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1)))
    );
    expect(written.mediaId).toBe(MEDIA_1);

    const read = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)));
    expect(read.tombstones).toEqual([mediaTombstone(MEDIA_1)]);
    // A tombstone is a claim, not a deletion: the manifest stays and the object
    // is still in storage.
    expect(read.manifests).toHaveLength(1);
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(true);
  });

  it('treats an identical retry as one row', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    await run(ctx.provide(postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1))));
    await run(ctx.provide(postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1))));
    const read = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)));
    expect(read.tombstones).toHaveLength(1);
  });

  it('keeps distinct candidates for one media rather than one row per target', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    await run(ctx.provide(postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1))));
    await run(
      ctx.provide(
        postAlbumMediaTombstoneProgram(
          USER_A,
          mediaTombstone(MEDIA_1, { revision: 3, deletedAt: '2026-01-16T00:00:00.000Z' })
        )
      )
    );
    const read = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)));
    expect(read.tombstones).toHaveLength(2);
  });

  it('refuses a tombstone for media this Space does not have', async () => {
    const ctx = await withUploader();
    const err = await failureOf(
      ctx.provide(postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1)))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('refuses a tombstone signed by a device the caller does not own', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    await run(ctx.provide(enrolProgram(USER_B, 'device-b', record('device-b'))));
    const err = await failureOf(
      ctx.provide(
        postAlbumMediaTombstoneProgram(
          USER_A,
          mediaTombstone(MEDIA_1, { deletedByDeviceId: 'device-b' })
        )
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a tombstone for another Space', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);
    const err = await failureOf(
      ctx.provide(
        postAlbumMediaTombstoneProgram(USER_A, mediaTombstone(MEDIA_1, { spaceId: OTHER_SPACE }))
      )
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('stores a forged huge-revision candidate without acting on it, and refuses one past the bound', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);

    // Within the counter bound the server stores it and does nothing else: it
    // cannot tell a forged revision from a real one and must not try.
    await run(
      ctx.provide(
        postAlbumMediaTombstoneProgram(
          USER_A,
          mediaTombstone(MEDIA_1, { revision: PROTOCOL_MAX_COUNTER })
        )
      )
    );
    const read = await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)));
    expect(read.tombstones).toHaveLength(1);
    expect(read.manifests).toHaveLength(1);

    // Past the counter bound is a structural failure, refused at the boundary.
    const err = await failureOf(
      ctx.provide(
        postAlbumMediaTombstoneProgram(
          USER_A,
          mediaTombstone(MEDIA_1, { revision: PROTOCOL_MAX_COUNTER + 1 })
        )
      )
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('scales the ceiling with the archive, accepts an exact retry, and reads every candidate back', async () => {
    const ctx = await withUploader();
    await completedMedia(ctx, MEDIA_1);
    await publishManifest(ctx, MEDIA_1);

    const ceiling = PROTOCOL_MEDIA_TOMBSTONE_BASE + PROTOCOL_MEDIA_TOMBSTONES_PER_MEDIA;
    const body = mediaTombstone(MEDIA_1);
    for (let index = 0; index < ceiling - 1; index += 1) {
      // Valid wire objects: the read parses every candidate back, so a filler
      // that is not a tombstone would make the read fail rather than fill it.
      ctx.harness.d1.runSync(
        `insert into album_media_tombstones (id, space_id, media_id, payload, created_at)
         values (?, ?, ?, ?, ?)`,
        `t-${index}`,
        SPACE_1,
        MEDIA_1,
        JSON.stringify(mediaTombstone(MEDIA_1, { revision: index + 3 })),
        T0
      );
    }
    ctx.harness.d1.runSync(
      `insert into album_media_tombstones (id, space_id, media_id, payload, created_at)
       values (?, ?, ?, ?, ?)`,
      't-full',
      SPACE_1,
      MEDIA_1,
      JSON.stringify(body),
      T0
    );

    // At the ceiling a distinct candidate is refused...
    expect(
      await failureOf(
        ctx.provide(
          postAlbumMediaTombstoneProgram(
            USER_A,
            mediaTombstone(MEDIA_1, { revision: 3, deletedAt: '2026-01-17T00:00:00.000Z' })
          )
        )
      )
    ).toBeInstanceOf(ConflictError);
    // ...an exact retry is not a new object, so it succeeds...
    expect(await run(ctx.provide(postAlbumMediaTombstoneProgram(USER_A, body)))).toEqual(body);
    // ...and the read returns every candidate rather than truncating to fit.
    expect(
      (await run(ctx.provide(getAlbumMediaProtocolProgram(USER_A)))).tombstones
    ).toHaveLength(ceiling);

    // A larger archive raises the ceiling, which is the whole point of scaling
    // it: the same distinct candidate is now accepted.
    await completedMedia(ctx, MEDIA_2);
    const late = mediaTombstone(MEDIA_1, {
      revision: 3,
      deletedAt: '2026-01-17T00:00:00.000Z',
    });
    expect(await run(ctx.provide(postAlbumMediaTombstoneProgram(USER_A, late)))).toEqual(late);
  });
});
