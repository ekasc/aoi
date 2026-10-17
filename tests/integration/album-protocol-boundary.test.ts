/**
 * Album protocol boundary integration tests: the REAL client-to-server path.
 *
 * Every step below goes over HTTP (ephemeral localhost, @hono/node-server)
 * through the ACTUAL AlbumProtocolClient (features/album/protocol-client),
 * the ACTUAL Hono routes (createApp) with session authentication, D1-backed
 * persistence (better-sqlite3 shim over the exact baseline migration SQL),
 * the ACTUAL @aoi/shared wire serialization, and REAL cryptographic signing,
 * sealing, and verification (features/album/protocol-crypto).
 *
 * No FakeServer, no mocked transport, no mocked SecureStore, no bypassed
 * enrollment. The single documented simulation: after a REAL reservation the
 * ciphertext is written to the harness R2 shim directly (the device-upload
 * leg that already succeeded), because the presigned URL points at real
 * object storage. The signed conditional PUT itself is proven by
 * r2-conditional-put.test.ts. Mocked here: only the Expo token-plumbing
 * module (@/features/api-client), which cannot load outside the Expo runtime;
 * the mock sets a real `Authorization: Bearer` header on a real fetch.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  encodeBase64,
  encodeMediaContext,
  parseWireDeviceRecord,
  parseWireMediaManifest,
  parseWireMediaTombstone,
  parseWireSpaceKeyEnvelope,
  toWireDeviceRecord,
  toWireMediaManifest,
  toWireMediaTombstone,
  toWireRecoveryEnvelope,
  toWireSpaceKeyEnvelope,
  toWireSpaceTrustAnchor,
} from '@aoi/shared';
import {
  deriveRecoverySigningKey,
  generateDeviceKeyMaterial,
  generateSpaceKey,
  openMediaCiphertext,
  openSpaceKeyFromEnvelope,
  openSpaceKeyFromRecoveryEnvelope,
  recoverySigningPublicKey,
  sealMediaCiphertext,
  sealSpaceKeyForDevice,
  sealSpaceKeyForRecovery,
  signDeviceRecord,
  signMediaManifest,
  signMediaTombstone,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
  unwrapMediaKey,
  verifyDeviceRecord,
  verifyMediaManifest,
  verifyMediaTombstone,
  wrapMediaKey,
} from '@/features/album/protocol-crypto';
import { verificationFingerprint } from '@/features/album/keys';
import {
  authenticateMediaTombstones,
  isMediaDeleted,
} from '@/features/album/protocol-read';
import {
  generateRecoveryPhrase,
  recoveryEntropyFromPhrase,
} from '@/features/album/recovery';
import {
  getAlbumProtocolClient,
  ProtocolRequestError,
  type AlbumProtocolClient,
} from '@/features/album/protocol-client';
import { albumMediaKey } from '../../packages/api/src/domains/album';
import {
  SPACE_ID,
  TOKEN_A,
  TOKEN_B,
  startBoundaryServer,
  tempD1File,
  setBoundaryBaseUrl,
  setBoundaryToken,
  type BoundaryServer,
} from './helpers/http-harness';

vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
  apiFetch: async (path: string, options: RequestInit = {}) => {
    const auth = (globalThis as Record<string, { baseUrl: string; token: string }>)
      .__albumBoundaryAuth;
    const response = await fetch(`${auth.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...((options.headers ?? {}) as Record<string, string>),
        Authorization: `Bearer ${auth.token}`,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = new Error(
        body?.error?.message ?? `Request failed: ${response.status}`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.json();
  },
  apiFetchBytes: async (path: string) => {
    const auth = (globalThis as Record<string, { baseUrl: string; token: string }>)
      .__albumBoundaryAuth;
    const response = await fetch(`${auth.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) {
      const error = new Error(`Media request failed: ${response.status}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
      status: response.status,
    };
  },
}));

const AT = '2026-01-15T00:00:00.000Z';
const MEDIA_1 = '00000000-0000-4000-8000-000000000101';
const MEDIA_2 = '00000000-0000-4000-8000-000000000102';

let server: BoundaryServer;
let alice: AlbumProtocolClient;
let bob: AlbumProtocolClient;

const asAlice = () => setBoundaryToken(TOKEN_A);
const asBob = () => setBoundaryToken(TOKEN_B);

async function rawFetch(
  method: string,
  path: string,
  token: string | null,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof ProtocolRequestError) return error.status;
    throw error;
  }
}

beforeAll(async () => {
  server = await startBoundaryServer();
  setBoundaryBaseUrl(server.baseUrl);
  alice = getAlbumProtocolClient();
  bob = getAlbumProtocolClient();
});

afterAll(async () => {
  await server.close();
});

// Shared world built once: Alice's archive, Bob enrolled, one photo sealed.
// Later describes reuse it and assert persisted state, never reseed it.
const world = {
  aliceKeys: generateDeviceKeyMaterial(),
  bobKeys: generateDeviceKeyMaterial(),
  spaceKey: generateSpaceKey(),
  phrase: '',
  entropy: new Uint8Array(),
};

async function buildWorld(): Promise<void> {
  world.phrase = generateRecoveryPhrase();
  world.entropy = recoveryEntropyFromPhrase(world.phrase);
  const { aliceKeys, bobKeys, spaceKey, entropy } = world;

  asAlice();
  const anchorInput = {
    spaceId: SPACE_ID,
    rootDeviceId: 'device-alice',
    rootSigningPublicKey: aliceKeys.signingPublicKey,
    recoverySigningPublicKey: recoverySigningPublicKey(entropy),
    createdAt: AT,
  };
  await alice.putAnchor(
    toWireSpaceTrustAnchor({
      ...anchorInput,
      rootSignature: signSpaceTrustAnchor(anchorInput, aliceKeys.signingPrivateKey),
      recoverySignature: signSpaceTrustAnchorRecovery(
        anchorInput,
        deriveRecoverySigningKey(entropy)
      ),
    })
  );
  await alice.claimDevice({
    deviceId: 'device-alice',
    signingPublicKey: encodeBase64(aliceKeys.signingPublicKey),
    agreementPublicKey: encodeBase64(aliceKeys.agreementPublicKey),
  });
  const aliceRecordInput = {
    deviceId: 'device-alice',
    spaceId: SPACE_ID,
    signingPublicKey: aliceKeys.signingPublicKey,
    agreementPublicKey: aliceKeys.agreementPublicKey,
    authorisedBy: { kind: 'self' as const },
    revision: 1,
    createdAt: AT,
  };
  await alice.putDeviceRecord(
    toWireDeviceRecord({
      ...aliceRecordInput,
      authorisation: signDeviceRecord(aliceRecordInput, aliceKeys.signingPrivateKey),
    })
  );
  await alice.putRecoveryEnvelope(
    1,
    toWireRecoveryEnvelope(
      sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE_ID, generation: 1, entropy })
    )
  );
  await alice.putSpaceKeyEnvelope(
    toWireSpaceKeyEnvelope(
      sealSpaceKeyForDevice({
        spaceKey,
        spaceId: SPACE_ID,
        generation: 1,
        recipientDeviceId: 'device-alice',
        authoriserDeviceId: 'device-alice',
        recipientRevision: 1,
        authoriserAgreementPrivateKey: aliceKeys.agreementPrivateKey,
        recipientAgreementPublicKey: aliceKeys.agreementPublicKey,
      })
    )
  );

  asBob();
  await bob.claimDevice({
    deviceId: 'device-bob',
    signingPublicKey: encodeBase64(bobKeys.signingPublicKey),
    agreementPublicKey: encodeBase64(bobKeys.agreementPublicKey),
  });

  asAlice();
  const bobRecordInput = {
    deviceId: 'device-bob',
    spaceId: SPACE_ID,
    signingPublicKey: bobKeys.signingPublicKey,
    agreementPublicKey: bobKeys.agreementPublicKey,
    authorisedBy: { kind: 'device' as const, deviceId: 'device-alice' },
    revision: 1,
    createdAt: AT,
  };
  await alice.putSpaceKeyEnvelope(
    toWireSpaceKeyEnvelope(
      sealSpaceKeyForDevice({
        spaceKey,
        spaceId: SPACE_ID,
        generation: 1,
        recipientDeviceId: 'device-bob',
        authoriserDeviceId: 'device-alice',
        recipientRevision: 1,
        authoriserAgreementPrivateKey: aliceKeys.agreementPrivateKey,
        recipientAgreementPublicKey: bobKeys.agreementPublicKey,
      })
    )
  );
  await alice.putEnrollmentOffer(
    toWireDeviceRecord({
      ...bobRecordInput,
      authorisation: signDeviceRecord(bobRecordInput, aliceKeys.signingPrivateKey),
    })
  );

  asBob();
  const snapshot = await bob.getSnapshot();
  const offer = snapshot.offers.find((entry) => entry.deviceId === 'device-bob');
  if (!offer) throw new Error('Bob never received Alice’s offer');
  await bob.putDeviceRecord(offer);
}

describe('integration: archive creation and reload', () => {
  it('builds the archive through the real client and reloads byte-identical state', async () => {
    await buildWorld();

    asAlice();
    const first = await alice.getSnapshot();
    expect(first.anchor).not.toBeNull();
    expect(first.records.map((record) => record.deviceId).sort()).toEqual([
      'device-alice',
      'device-bob',
    ]);
    expect(first.recoveryEnvelopes).toHaveLength(1);

    // Reload: a fresh client over a fresh HTTP connection sees the same bytes.
    const reloaded = await getAlbumProtocolClient().getSnapshot();
    expect(reloaded).toEqual(first);

    // And the persisted rows verify under real signatures.
    const { parseWireSpaceTrustAnchor } = await import('@aoi/shared');
    const anchor = parseWireSpaceTrustAnchor(first.anchor);
    const { verifySpaceTrustAnchor } = await import('@/features/album/protocol-crypto');
    expect(verifySpaceTrustAnchor(anchor, world.aliceKeys.signingPublicKey)).toBe(true);
    for (const wire of first.records) {
      const record = parseWireDeviceRecord(wire);
      const signer =
        record.authorisedBy.kind === 'self'
          ? world.aliceKeys.signingPublicKey
          : record.authorisedBy.kind === 'device'
            ? world.aliceKeys.signingPublicKey
            : deriveRecoverySigningKey(world.entropy);
      expect(verifyDeviceRecord(record, signer)).toBe(true);
    }
  });

  it('rejects a conflicting anchor with 409 and keeps the original', async () => {
    asAlice();
    const before = await alice.getSnapshot();
    const forged = {
      ...(before.anchor as Record<string, unknown>),
      rootDeviceId: 'device-impostor',
    };
    await expect(alice.putAnchor(forged as never)).rejects.toMatchObject({ status: 409 });
    expect(await alice.getSnapshot()).toEqual(before);
  });

  it('requires a session: the snapshot without a token is 401', async () => {
    const { status, json } = await rawFetch('GET', '/v1/spaces/current/album/protocol', null);
    expect(status).toBe(401);
    expect(json).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  });
});

describe('integration: claim, approval, and acceptance', () => {
  it('shows the same fingerprint on both phones', () => {
    const fromAlice = verificationFingerprint(
      world.aliceKeys.signingPublicKey,
      world.bobKeys.signingPublicKey
    );
    const fromBob = verificationFingerprint(
      world.bobKeys.signingPublicKey,
      world.aliceKeys.signingPublicKey
    );
    expect(fromAlice).toBe(fromBob);
    expect(fromAlice.split(' ')).toHaveLength(12);
  });

  it('Bob opened Alice’s space key from her envelope: the same bytes', async () => {
    asBob();
    const snapshot = await bob.getSnapshot();
    const sealed = snapshot.envelopes.find(
      (entry) =>
        entry.recipientDeviceId === 'device-bob' && entry.authoriserDeviceId === 'device-alice'
    );
    expect(sealed).toBeTruthy();
    const opened = openSpaceKeyFromEnvelope({
      envelope: parseWireSpaceKeyEnvelope(sealed),
      recipientAgreementPrivateKey: world.bobKeys.agreementPrivateKey,
      authoriserAgreementPublicKey: world.aliceKeys.agreementPublicKey,
    });
    expect(opened).toEqual(world.spaceKey);
  });
});

describe('integration: enrollment rejection', () => {
  it('refuses an offer whose keys do not match the claim (400) and keeps no offer', async () => {
    asBob();
    await bob.claimDevice({
      deviceId: 'device-mallory-claim',
      signingPublicKey: encodeBase64(world.bobKeys.signingPublicKey),
      agreementPublicKey: encodeBase64(world.bobKeys.agreementPublicKey),
    });
    asAlice();
    const imposter = generateDeviceKeyMaterial();
    const forgedInput = {
      deviceId: 'device-mallory-claim',
      spaceId: SPACE_ID,
      signingPublicKey: imposter.signingPublicKey,
      agreementPublicKey: imposter.agreementPublicKey,
      authorisedBy: { kind: 'device' as const, deviceId: 'device-alice' },
      revision: 1,
      createdAt: AT,
    };
    const forged = toWireDeviceRecord({
      ...forgedInput,
      authorisation: signDeviceRecord(forgedInput, world.aliceKeys.signingPrivateKey),
    });
    await expect(alice.putEnrollmentOffer(forged)).rejects.toMatchObject({ status: 400 });
    const snapshot = await alice.getSnapshot();
    expect(snapshot.offers.find((entry) => entry.deviceId === 'device-mallory-claim')).toBeUndefined();
  });

  it('refuses a partner claiming an id the other account owns (403)', async () => {
    asBob();
    await expect(
      bob.claimDevice({
        deviceId: 'device-alice',
        signingPublicKey: encodeBase64(world.bobKeys.signingPublicKey),
        agreementPublicKey: encodeBase64(world.bobKeys.agreementPublicKey),
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a record for a device that never claimed (400) and an envelope for a ghost (400)', async () => {
    asAlice();
    const ghost = generateDeviceKeyMaterial();
    const ghostInput = {
      deviceId: 'device-ghost',
      spaceId: SPACE_ID,
      signingPublicKey: ghost.signingPublicKey,
      agreementPublicKey: ghost.agreementPublicKey,
      authorisedBy: { kind: 'device' as const, deviceId: 'device-alice' },
      revision: 1,
      createdAt: AT,
    };
    await expect(
      alice.putDeviceRecord(
        toWireDeviceRecord({
          ...ghostInput,
          authorisation: signDeviceRecord(ghostInput, world.aliceKeys.signingPrivateKey),
        })
      )
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      alice.putSpaceKeyEnvelope(
        toWireSpaceKeyEnvelope(
          sealSpaceKeyForDevice({
            spaceKey: world.spaceKey,
            spaceId: SPACE_ID,
            generation: 1,
            recipientDeviceId: 'device-ghost',
            authoriserDeviceId: 'device-alice',
            recipientRevision: 1,
            authoriserAgreementPrivateKey: world.aliceKeys.agreementPrivateKey,
            recipientAgreementPublicKey: ghost.agreementPublicKey,
          })
        )
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a revision that does not move forward (409)', async () => {
    asAlice();
    const snapshot = await alice.getSnapshot();
    const current = snapshot.records.find((entry) => entry.deviceId === 'device-alice');
    expect(current).toBeTruthy();
    await expect(alice.putDeviceRecord(current as never)).rejects.toMatchObject({ status: 409 });
  });
});

describe('integration: encrypted media publish, retrieve, and decrypt', () => {
  const plaintext = new TextEncoder().encode('alice’s lakeside photo');

  it('publishes a signed manifest and Bob decrypts the exact bytes', async () => {
    const mediaKey = new Uint8Array(32).fill(11);
    const context = encodeMediaContext({ mediaId: MEDIA_1, generation: 1 });
    const sealed = sealMediaCiphertext({ mediaKey, plaintext, context });

    asAlice();
    const reservation = await alice.reserveMedia({
      mediaId: MEDIA_1,
      generation: 1,
      uploaderDeviceId: 'device-alice',
      byteLength: sealed.ciphertext.length,
    });
    expect(reservation.mediaId).toBe(MEDIA_1);
    expect(reservation.uploadUrl).toMatch(/^https:\/\//);
    // The device-upload leg (see header): the ciphertext lands in the R2 shim
    // after the real reservation, exactly as a completed PUT would leave it.
    server.harness.r2.putSync(
      albumMediaKey(SPACE_ID, MEDIA_1),
      sealed.ciphertext,
      'application/octet-stream'
    );
    await alice.finalizeMedia(MEDIA_1);

    const manifestInput = {
      mediaId: MEDIA_1,
      spaceId: SPACE_ID,
      generation: 1,
      revision: 1,
      wrappedKey: wrapMediaKey({ spaceKey: world.spaceKey, mediaKey, context }),
      sealedNonce: sealed.nonce,
      byteLength: sealed.ciphertext.length,
      mimeType: 'image/jpeg',
      uploaderDeviceId: 'device-alice',
      createdAt: AT,
    };
    await alice.putManifest(
      MEDIA_1,
      toWireMediaManifest({
        ...manifestInput,
        signature: signMediaManifest(manifestInput, world.aliceKeys.signingPrivateKey),
      })
    );

    asBob();
    const page = await bob.fetchMediaProtocol(null);
    const listed = page.manifests.find((entry) => entry.mediaId === MEDIA_1);
    expect(listed).toBeTruthy();
    expect(page.nextCursor).toBeNull();
    const manifest = parseWireMediaManifest(listed);
    expect(verifyMediaManifest(manifest, world.aliceKeys.signingPublicKey)).toBe(true);

    const bytes = await bob.fetchMediaObject(MEDIA_1);
    expect(bytes).toEqual(sealed.ciphertext);
    const openedKey = unwrapMediaKey({
      spaceKey: world.spaceKey,
      wrapped: manifest.wrappedKey,
      context,
    });
    expect(
      new TextDecoder().decode(
        openMediaCiphertext({ mediaKey: openedKey, sealed: { nonce: manifest.sealedNonce, ciphertext: bytes }, context })
      )
    ).toBe('alice’s lakeside photo');
  });

  it('serves real error responses: bad reservation id, ghost manifest, path/body mismatch', async () => {
    asAlice();
    expect(
      await statusOf(
        alice.reserveMedia({
          mediaId: 'not-a-uuid',
          generation: 1,
          uploaderDeviceId: 'device-alice',
          byteLength: 3,
        })
      )
    ).toBe(400);

    const { status: objectStatus } = await rawFetch(
      'GET',
      `/v1/spaces/current/album/protocol/media/${MEDIA_2}/object`,
      TOKEN_A
    );
    expect(objectStatus).toBe(404);

    const { status: mismatch } = await rawFetch(
      'PUT',
      `/v1/spaces/current/album/protocol/media/${MEDIA_2}/manifest`,
      TOKEN_A,
      {
        mediaId: MEDIA_1,
        spaceId: SPACE_ID,
        generation: 1,
        revision: 1,
        wrappedKey: {
          nonce: encodeBase64(new Uint8Array(12).fill(1)),
          ciphertext: encodeBase64(new Uint8Array(48).fill(2)),
        },
        sealedNonce: encodeBase64(new Uint8Array(12).fill(3)),
        byteLength: 3,
        mimeType: 'image/jpeg',
        uploaderDeviceId: 'device-alice',
        createdAt: AT,
        signature: encodeBase64(new Uint8Array(64).fill(4)),
      }
    );
    expect(mismatch).toBe(400);
  });
});

describe('integration: conflicting claims, duplicates, and interrupted writes', () => {
  it('treats an identical claim retry as success and a same-id/different-keys claim as conflict', async () => {
    // A still-pending id: claimed twice with the same keys is one row, not two.
    const pending = generateDeviceKeyMaterial();
    const keys = {
      deviceId: 'device-pending',
      signingPublicKey: encodeBase64(pending.signingPublicKey),
      agreementPublicKey: encodeBase64(pending.agreementPublicKey),
    };
    asBob();
    await bob.claimDevice(keys);
    await bob.claimDevice(keys);
    const snapshot = await bob.getSnapshot();
    expect(snapshot.claims.filter((claim) => claim.deviceId === 'device-pending')).toHaveLength(1);

    const other = generateDeviceKeyMaterial();
    await expect(
      bob.claimDevice({
        deviceId: 'device-pending',
        signingPublicKey: encodeBase64(other.signingPublicKey),
        agreementPublicKey: encodeBase64(other.agreementPublicKey),
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('leaves an interrupted upload pending: complete without bytes is 400, retry then succeeds', async () => {
    asAlice();
    await alice.reserveMedia({
      mediaId: MEDIA_2,
      generation: 1,
      uploaderDeviceId: 'device-alice',
      byteLength: 5,
    });
    // Crash between reservation and PUT: finalising finds no object.
    await expect(alice.finalizeMedia(MEDIA_2)).rejects.toMatchObject({ status: 400 });

    // Retry delivers the bytes; the same reservation completes.
    server.harness.r2.putSync(
      albumMediaKey(SPACE_ID, MEDIA_2),
      new Uint8Array(5).fill(21),
      'application/octet-stream'
    );
    await alice.finalizeMedia(MEDIA_2);
    // And completing twice is success, not a conflict.
    await alice.finalizeMedia(MEDIA_2);
  });

  it('keeps the first manifest payload: identical republish succeeds, different payload conflicts', async () => {
    asBob();
    const page = await bob.fetchMediaProtocol(null);
    const listed = page.manifests.find((entry) => entry.mediaId === MEDIA_1);
    expect(listed).toBeTruthy();

    asAlice();
    await alice.putManifest(MEDIA_1, listed as never);
    const altered = { ...(listed as Record<string, unknown>), revision: 2 };
    await expect(alice.putManifest(MEDIA_1, altered as never)).rejects.toMatchObject({
      status: 409,
    });

    asBob();
    const again = await bob.fetchMediaProtocol(null);
    expect(again.manifests.find((entry) => entry.mediaId === MEDIA_1)).toEqual(listed);
  });
});

describe('integration: concurrent requests and transactional invariants', () => {
  it('settles eight concurrent identical anchors on exactly one row', async () => {
    asAlice();
    const before = await alice.getSnapshot();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => rawFetch('PUT', '/v1/spaces/current/album/protocol/anchor', TOKEN_A, before.anchor))
    );
    expect(results.filter((result) => result.status === 'fulfilled').length).toBe(8);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value.status).toBe(201);
    }
    expect(await alice.getSnapshot()).toEqual(before);
  });

  it('keeps device revisions monotonic under concurrent writes: the max wins, one row survives', async () => {
    asAlice();
    const snapshot = await alice.getSnapshot();
    const current = parseWireDeviceRecord(
      snapshot.records.find((entry) => entry.deviceId === 'device-alice')
    );
    const baseRevision = current.revision;
    // Each bump is really signed: the server is a relay and stores whatever
    // the owner writes, so publishing broken signatures here would poison the
    // highest-revision row every later provenance check reads.
    const bodies = Array.from({ length: 6 }, (_, index) => {
      const input = { ...current, revision: baseRevision + index + 1 };
      const { authorisation: _dropped, ...unsigned } = input;
      void _dropped;
      return toWireDeviceRecord({
        ...unsigned,
        authorisation: signDeviceRecord(unsigned, world.aliceKeys.signingPrivateKey),
      });
    });
    const results = await Promise.allSettled(
      bodies.map((body) =>
        rawFetch('PUT', '/v1/spaces/current/album/protocol/devices/device-alice', TOKEN_A, body)
      )
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const after = await alice.getSnapshot();
    const rows = after.records.filter((entry) => entry.deviceId === 'device-alice');
    expect(rows).toHaveLength(1);
    expect((rows[0] as { revision: number }).revision).toBe(baseRevision + 6);
  });

  it('never lets one account rewrite the partner’s device row, even concurrently', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        rawFetch('PUT', '/v1/spaces/current/album/protocol/devices/device-alice', TOKEN_B, {
          deviceId: 'device-alice',
          spaceId: SPACE_ID,
          signingPublicKey: encodeBase64(world.aliceKeys.signingPublicKey),
          agreementPublicKey: encodeBase64(world.aliceKeys.agreementPublicKey),
          authorisedBy: { kind: 'self' },
          revision: 100 + index,
          createdAt: AT,
          authorisation: encodeBase64(new Uint8Array(64).fill(9)),
        })
      )
    );
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled') expect(attempt.value.status).toBe(403);
    }
    asAlice();
    const snapshot = await alice.getSnapshot();
    const row = snapshot.records.find((entry) => entry.deviceId === 'device-alice');
    expect((row as { revision: number }).revision).toBeLessThan(100);
  });
});

describe('integration: recovery with a replacement identity', () => {
  it('Charlie recovers from the phrase and decrypts the previously shared photo', async () => {
    const charlie = generateDeviceKeyMaterial();

    asBob();
    await bob.claimDevice({
      deviceId: 'device-charlie',
      signingPublicKey: encodeBase64(charlie.signingPublicKey),
      agreementPublicKey: encodeBase64(charlie.agreementPublicKey),
    });

    // The phrase authorises the replacement: signed by the recovery key.
    const recordInput = {
      deviceId: 'device-charlie',
      spaceId: SPACE_ID,
      signingPublicKey: charlie.signingPublicKey,
      agreementPublicKey: charlie.agreementPublicKey,
      authorisedBy: { kind: 'recovery' as const },
      revision: 1,
      createdAt: AT,
    };
    await bob.putDeviceRecord(
      toWireDeviceRecord({
        ...recordInput,
        authorisation: signDeviceRecord(recordInput, deriveRecoverySigningKey(world.entropy)),
      })
    );

    // Charlie opens the stable key from the recovery envelope and reads Alice's photo.
    const snapshot = await bob.getSnapshot();
    const recoveryEnvelope = snapshot.recoveryEnvelopes.find(
      (entry) => entry.generation === 1
    );
    expect(recoveryEnvelope).toBeTruthy();
    const { parseWireRecoveryEnvelope } = await import('@aoi/shared');
    const spaceKey = openSpaceKeyFromRecoveryEnvelope({
      envelope: parseWireRecoveryEnvelope(recoveryEnvelope),
      entropy: world.entropy,
    });
    expect(spaceKey).toEqual(world.spaceKey);

    const page = await bob.fetchMediaProtocol(null);
    const listed = page.manifests.find((entry) => entry.mediaId === MEDIA_1);
    const manifest = parseWireMediaManifest(listed);
    const context = encodeMediaContext({ mediaId: MEDIA_1, generation: 1 });
    const mediaKey = unwrapMediaKey({ spaceKey, wrapped: manifest.wrappedKey, context });
    const bytes = await bob.fetchMediaObject(MEDIA_1);
    expect(
      new TextDecoder().decode(
        openMediaCiphertext({ mediaKey, sealed: { nonce: manifest.sealedNonce, ciphertext: bytes }, context })
      )
    ).toBe('alice’s lakeside photo');
  });
});

describe('integration: authenticated deletion and restart persistence', () => {
  let restartFile = '';
  let restartServer: BoundaryServer | null = null;

  it('publishes a signed tombstone; Bob’s client authenticates the deletion', async () => {
    asAlice();
    const tombstoneInput = {
      spaceId: SPACE_ID,
      mediaId: MEDIA_1,
      revision: 2,
      deletedAt: AT,
      deletedByDeviceId: 'device-alice',
    };
    await alice.postMediaTombstone(
      toWireMediaTombstone({
        ...tombstoneInput,
        signature: signMediaTombstone(tombstoneInput, world.aliceKeys.signingPrivateKey),
      })
    );

    asBob();
    const page = await bob.fetchMediaProtocol(null);
    const manifest = parseWireMediaManifest(
      page.manifests.find((entry) => entry.mediaId === MEDIA_1)
    );
    const snapshot = await bob.getSnapshot();
    const authenticated = authenticateMediaTombstones({
      anchor: (await import('@aoi/shared')).parseWireSpaceTrustAnchor(snapshot.anchor),
      records: snapshot.records.map((entry) => parseWireDeviceRecord(entry)),
      tombstones: page.tombstones,
    });
    expect(authenticated).toHaveLength(1);
    expect(verifyMediaTombstone(authenticated[0], world.aliceKeys.signingPublicKey)).toBe(true);
    expect(isMediaDeleted(manifest, authenticated)).toBe(true);
  });

  it('rejects tombstones without a session (401) or with a malformed body (400)', async () => {
    const { status: anon } = await rawFetch(
      'POST',
      '/v1/spaces/current/album/protocol/media-tombstones',
      null,
      { spaceId: SPACE_ID }
    );
    expect(anon).toBe(401);
    const { status: malformed } = await rawFetch(
      'POST',
      '/v1/spaces/current/album/protocol/media-tombstones',
      TOKEN_A,
      { spaceId: SPACE_ID }
    );
    expect(malformed).toBe(400);
  });

  it('persists the archive across a server restart: nothing resurrects, nothing is lost', async () => {
    // Rebuild the whole world on a file-backed D1 so a reboot keeps the rows.
    restartFile = tempD1File();
    restartServer = await startBoundaryServer({ filename: restartFile });
    setBoundaryBaseUrl(restartServer.baseUrl);
    const restartedAlice = getAlbumProtocolClient();

    const phrase = generateRecoveryPhrase();
    const entropy = recoveryEntropyFromPhrase(phrase);
    const rootKeys = generateDeviceKeyMaterial();
    const spaceKey = generateSpaceKey();
    const anchorInput = {
      spaceId: SPACE_ID,
      rootDeviceId: 'device-alice',
      rootSigningPublicKey: rootKeys.signingPublicKey,
      recoverySigningPublicKey: recoverySigningPublicKey(entropy),
      createdAt: AT,
    };
    setBoundaryToken(TOKEN_A);
    await restartedAlice.putAnchor(
      toWireSpaceTrustAnchor({
        ...anchorInput,
        rootSignature: signSpaceTrustAnchor(anchorInput, rootKeys.signingPrivateKey),
        recoverySignature: signSpaceTrustAnchorRecovery(
          anchorInput,
          deriveRecoverySigningKey(entropy)
        ),
      })
    );
    await restartedAlice.claimDevice({
      deviceId: 'device-alice',
      signingPublicKey: encodeBase64(rootKeys.signingPublicKey),
      agreementPublicKey: encodeBase64(rootKeys.agreementPublicKey),
    });
    const recordInput = {
      deviceId: 'device-alice',
      spaceId: SPACE_ID,
      signingPublicKey: rootKeys.signingPublicKey,
      agreementPublicKey: rootKeys.agreementPublicKey,
      authorisedBy: { kind: 'self' as const },
      revision: 1,
      createdAt: AT,
    };
    await restartedAlice.putDeviceRecord(
      toWireDeviceRecord({
        ...recordInput,
        authorisation: signDeviceRecord(recordInput, rootKeys.signingPrivateKey),
      })
    );
    await restartedAlice.putRecoveryEnvelope(
      1,
      toWireRecoveryEnvelope(
        sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE_ID, generation: 1, entropy })
      )
    );

    const mediaKey = new Uint8Array(32).fill(31);
    const mediaId = '00000000-0000-4000-8000-000000000201';
    const context = encodeMediaContext({ mediaId, generation: 1 });
    const sealed = sealMediaCiphertext({
      mediaKey,
      plaintext: new TextEncoder().encode('restart photo'),
      context,
    });
    await restartedAlice.reserveMedia({
      mediaId,
      generation: 1,
      uploaderDeviceId: 'device-alice',
      byteLength: sealed.ciphertext.length,
    });
    restartServer.harness.r2.putSync(
      albumMediaKey(SPACE_ID, mediaId),
      sealed.ciphertext,
      'application/octet-stream'
    );
    await restartedAlice.finalizeMedia(mediaId);
    const manifestInput = {
      mediaId,
      spaceId: SPACE_ID,
      generation: 1,
      revision: 1,
      wrappedKey: wrapMediaKey({ spaceKey, mediaKey, context }),
      sealedNonce: sealed.nonce,
      byteLength: sealed.ciphertext.length,
      mimeType: 'image/jpeg',
      uploaderDeviceId: 'device-alice',
      createdAt: AT,
    };
    await restartedAlice.putManifest(
      mediaId,
      toWireMediaManifest({
        ...manifestInput,
        signature: signMediaManifest(manifestInput, rootKeys.signingPrivateKey),
      })
    );
    const tombstoneInput = {
      spaceId: SPACE_ID,
      mediaId,
      revision: 2,
      deletedAt: AT,
      deletedByDeviceId: 'device-alice',
    };
    await restartedAlice.postMediaTombstone(
      toWireMediaTombstone({
        ...tombstoneInput,
        signature: signMediaTombstone(tombstoneInput, rootKeys.signingPrivateKey),
      })
    );

    const before = await restartedAlice.getSnapshot();
    const beforeMedia = await restartedAlice.fetchMediaProtocol(null);
    await restartServer.close();

    // Reboot against the same file: R2 shim is memory-only, so reseed the
    // object bytes the way a real object store (which survives reboots)
    // would still hold them.
    restartServer = await startBoundaryServer({ filename: restartFile });
    setBoundaryBaseUrl(restartServer.baseUrl);
    restartServer.harness.r2.putSync(
      albumMediaKey(SPACE_ID, mediaId),
      sealed.ciphertext,
      'application/octet-stream'
    );
    const rebooted = getAlbumProtocolClient();
    setBoundaryToken(TOKEN_A);

    expect(await rebooted.getSnapshot()).toEqual(before);
    const afterMedia = await rebooted.fetchMediaProtocol(null);
    expect(afterMedia).toEqual(beforeMedia);
    expect(
      parseWireMediaTombstone(
        afterMedia.tombstones.find((entry) => entry.mediaId === mediaId)
      ).revision
    ).toBe(2);
    // The deleted photo does not reappear: the tombstone still authenticates.
    const { parseWireSpaceTrustAnchor } = await import('@aoi/shared');
    const authenticated = authenticateMediaTombstones({
      anchor: parseWireSpaceTrustAnchor((await rebooted.getSnapshot()).anchor),
      records: (await rebooted.getSnapshot()).records.map((entry) =>
        parseWireDeviceRecord(entry)
      ),
      tombstones: afterMedia.tombstones,
    });
    expect(
      isMediaDeleted(parseWireMediaManifest(afterMedia.manifests[0]), authenticated)
    ).toBe(true);
    // Bob's view agrees after the reboot too.
    setBoundaryToken(TOKEN_B);
    expect(
      (await rebooted.fetchMediaProtocol(null)).tombstones.filter(
        (entry) => entry.mediaId === mediaId
      )
    ).toHaveLength(1);

    await restartServer.close();
    restartServer = null;
    setBoundaryBaseUrl(server.baseUrl);
  });
});
