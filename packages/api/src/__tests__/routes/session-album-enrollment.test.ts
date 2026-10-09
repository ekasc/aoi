import { describe, expect, it } from 'vitest';

import {
  encodeBase64,
  encodeMediaContext,
  toWireDeviceRecord,
  toWireMediaManifest,
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
  recoverySigningPublicKey,
  sealMediaCiphertext,
  sealSpaceKeyForDevice,
  sealSpaceKeyForRecovery,
  signDeviceRecord,
  signMediaManifest,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
  unwrapMediaKey,
  verifyDeviceRecord,
  verifyMediaManifest,
  wrapMediaKey,
} from '../../../../../features/album/protocol-crypto';
import { albumMediaKey } from '../../domains/album';
import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Alice approves Bob through the real API handlers.
 *
 * No FakeServer: every step below goes through the Hono routes and the D1
 * harness with real keys, real signatures, and real seals. Bob claims, Alice
 * signs and publishes the envelope plus the offer, Bob verifies the offer and
 * publishes his own record, opens the space key, and finally opens a photo
 * Alice sealed — which is the whole enrollment promise in one test.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const AT = '2026-01-15T00:00:00.000Z';
const MEDIA_1 = '00000000-0000-4000-8000-000000000101';

const BASE = '/v1/spaces/current/album/protocol';
const MEDIA_BASE = `${BASE}/media`;

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    NOW,
    NOW
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    NOW + YEAR_MS,
    NOW,
    NOW
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);

  insertUser(harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  harness.d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    SPACE_1,
    USER_A,
    NOW,
    NOW
  );
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    SPACE_1,
    USER_A,
    NOW
  );
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)`,
    SPACE_1,
    USER_B,
    NOW
  );

  return { harness, app };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function put(app: ReturnType<typeof makeApp>['app'], path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(app: ReturnType<typeof makeApp>['app'], path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('enrollment through the real handlers', () => {
  it('takes Bob from a claim to opening Alice’s encrypted photo', async () => {
    const { harness, app } = makeApp();

    const alice = generateDeviceKeyMaterial();
    const bob = generateDeviceKeyMaterial();
    const spaceKey = generateSpaceKey();
    const entropy = new Uint8Array(32).fill(7);

    // 1. Alice creates the Space: anchor, her claim, her self-signed record,
    //    and the recovery envelope.
    const anchorInput = {
      spaceId: SPACE_1,
      rootDeviceId: 'device-a',
      rootSigningPublicKey: alice.signingPublicKey,
      recoverySigningPublicKey: recoverySigningPublicKey(entropy),
      createdAt: AT,
    };
    const anchor = toWireSpaceTrustAnchor({
      ...anchorInput,
      rootSignature: signSpaceTrustAnchor(anchorInput, alice.signingPrivateKey),
      recoverySignature: signSpaceTrustAnchorRecovery(
        anchorInput,
        deriveRecoverySigningKey(entropy)
      ),
    });
    expect((await put(app, `${BASE}/anchor`, TOKEN_A, anchor)).status).toBe(201);

    const aliceClaim = {
      deviceId: 'device-a',
      signingPublicKey: encodeBase64(alice.signingPublicKey),
      agreementPublicKey: encodeBase64(alice.agreementPublicKey),
    };
    expect((await post(app, `${BASE}/device-claims`, TOKEN_A, aliceClaim)).status).toBe(201);

    const aliceRecordInput = {
      deviceId: 'device-a',
      spaceId: SPACE_1,
      signingPublicKey: alice.signingPublicKey,
      agreementPublicKey: alice.agreementPublicKey,
      authorisedBy: { kind: 'self' as const },
      revision: 1,
      createdAt: AT,
    };
    const aliceRecord = toWireDeviceRecord({
      ...aliceRecordInput,
      authorisation: signDeviceRecord(aliceRecordInput, alice.signingPrivateKey),
    });
    expect((await put(app, `${BASE}/devices/device-a`, TOKEN_A, aliceRecord)).status).toBe(201);

    expect(
      (
        await put(
          app,
          `${BASE}/recovery-envelopes/1`,
          TOKEN_A,
          toWireRecoveryEnvelope(
            sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE_1, generation: 1, entropy })
          )
        )
      ).status
    ).toBe(201);

    // Alice seals the key to herself so the self-envelope path exists too.
    expect(
      (
        await put(
          app,
          `${BASE}/envelopes`,
          TOKEN_A,
          toWireSpaceKeyEnvelope(
            sealSpaceKeyForDevice({
              spaceKey,
              spaceId: SPACE_1,
              generation: 1,
              recipientDeviceId: 'device-a',
              authoriserDeviceId: 'device-a',
              recipientRevision: 1,
              authoriserAgreementPrivateKey: alice.agreementPrivateKey,
              recipientAgreementPublicKey: alice.agreementPublicKey,
            })
          )
        )
      ).status
    ).toBe(201);

    // 2. Bob claims his own id and keys. He has no record yet.
    const bobClaim = {
      deviceId: 'device-b',
      signingPublicKey: encodeBase64(bob.signingPublicKey),
      agreementPublicKey: encodeBase64(bob.agreementPublicKey),
    };
    expect((await post(app, `${BASE}/device-claims`, TOKEN_B, bobClaim)).status).toBe(201);

    // 3. Alice sees Bob's pending claim in her snapshot.
    const snapshot = (await (await app.request(BASE, { headers: auth(TOKEN_A) })).json()) as {
      claims: { deviceId: string }[];
    };
    expect(snapshot.claims.map((claim) => claim.deviceId)).toContain('device-b');

    // 4. Alice approves: a real sealed envelope plus the signed record as an
    //    offer. The envelope goes through only because Bob claimed — before the
    //    fix this exact request failed with "not registered".
    const bobRecordInput = {
      deviceId: 'device-b',
      spaceId: SPACE_1,
      signingPublicKey: bob.signingPublicKey,
      agreementPublicKey: bob.agreementPublicKey,
      authorisedBy: { kind: 'device' as const, deviceId: 'device-a' },
      revision: 1,
      createdAt: AT,
    };
    const bobRecord = toWireDeviceRecord({
      ...bobRecordInput,
      authorisation: signDeviceRecord(bobRecordInput, alice.signingPrivateKey),
    });
    expect(
      (
        await put(
          app,
          `${BASE}/envelopes`,
          TOKEN_A,
          toWireSpaceKeyEnvelope(
            sealSpaceKeyForDevice({
              spaceKey,
              spaceId: SPACE_1,
              generation: 1,
              recipientDeviceId: 'device-b',
              authoriserDeviceId: 'device-a',
              recipientRevision: 1,
              authoriserAgreementPrivateKey: alice.agreementPrivateKey,
              recipientAgreementPublicKey: bob.agreementPublicKey,
            })
          )
        )
      ).status
    ).toBe(201);
    expect((await put(app, `${BASE}/enrollment-offers/device-b`, TOKEN_A, bobRecord)).status).toBe(
      201
    );

    // 5. Bob collects the offer, verifies Alice's signature against her key,
    //    and publishes the record under his own account. The authoriser never
    //    writes his row.
    const bobSnapshot = (await (
      await app.request(BASE, { headers: auth(TOKEN_B) })
    ).json()) as {
      offers: typeof bobRecord[];
      envelopes: ReturnType<typeof toWireSpaceKeyEnvelope>[];
    };
    const offer = bobSnapshot.offers.find((entry) => entry.deviceId === 'device-b');
    expect(offer).toBeTruthy();
    const { parseWireDeviceRecord } = await import('@aoi/shared');
    const parsedOffer = parseWireDeviceRecord(offer);
    expect(verifyDeviceRecord(parsedOffer, alice.signingPublicKey)).toBe(true);
    expect((await put(app, `${BASE}/devices/device-b`, TOKEN_B, offer)).status).toBe(201);

    // 6. Bob opens the space key from Alice's envelope: the same bytes.
    const sealed = bobSnapshot.envelopes.find(
      (entry) => entry.recipientDeviceId === 'device-b' && entry.authoriserDeviceId === 'device-a'
    );
    expect(sealed).toBeTruthy();
    const { parseWireSpaceKeyEnvelope } = await import('@aoi/shared');
    const bobSpaceKey = openSpaceKeyFromEnvelope({
      envelope: parseWireSpaceKeyEnvelope(sealed),
      recipientAgreementPrivateKey: bob.agreementPrivateKey,
      authoriserAgreementPublicKey: alice.agreementPublicKey,
    });
    expect(Buffer.from(bobSpaceKey)).toEqual(Buffer.from(spaceKey));

    // 7. Alice seals a photo; Bob opens it, all through the real routes.
    const mediaKey = new Uint8Array(32).fill(3);
    const context = encodeMediaContext({ mediaId: MEDIA_1, generation: 1 });
    const plaintext = new TextEncoder().encode('alice’s photo');
    const sealedMedia = sealMediaCiphertext({ mediaKey, plaintext, context });
    const manifestInput = {
      mediaId: MEDIA_1,
      spaceId: SPACE_1,
      generation: 1,
      revision: 1,
      wrappedKey: wrapMediaKey({ spaceKey, mediaKey, context }),
      sealedNonce: sealedMedia.nonce,
      byteLength: sealedMedia.ciphertext.length,
      mimeType: 'image/jpeg',
      uploaderDeviceId: 'device-a',
      createdAt: AT,
    };
    const manifest = toWireMediaManifest({
      ...manifestInput,
      signature: signMediaManifest(manifestInput, alice.signingPrivateKey),
    });

    expect(
      (
        await post(app, MEDIA_BASE, TOKEN_A, {
          mediaId: MEDIA_1,
          generation: 1,
          uploaderDeviceId: 'device-a',
          byteLength: sealedMedia.ciphertext.length,
        })
      ).status
    ).toBe(201);
    harness.r2.putSync(
      albumMediaKey(SPACE_1, MEDIA_1),
      sealedMedia.ciphertext,
      'application/octet-stream'
    );
    expect((await post(app, `${MEDIA_BASE}/${MEDIA_1}/complete`, TOKEN_A, {})).status).toBe(200);
    expect((await put(app, `${MEDIA_BASE}/${MEDIA_1}/manifest`, TOKEN_A, manifest)).status).toBe(201);

    const object = await app.request(`${MEDIA_BASE}/${MEDIA_1}/object`, {
      headers: auth(TOKEN_B),
    });
    expect(object.status).toBe(200);
    const bytes = new Uint8Array(await object.arrayBuffer());

    const { parseWireMediaManifest } = await import('@aoi/shared');
    const read = await app.request(MEDIA_BASE, { headers: auth(TOKEN_B) });
    const listed = ((await read.json()) as { manifests: typeof manifest[] }).manifests.find(
      (entry) => entry.mediaId === MEDIA_1
    );
    const parsedManifest = parseWireMediaManifest(listed);
    expect(verifyMediaManifest(parsedManifest, alice.signingPublicKey)).toBe(true);
    const openedKey = unwrapMediaKey({ spaceKey: bobSpaceKey, wrapped: parsedManifest.wrappedKey, context });
    expect(
      new TextDecoder().decode(
        openMediaCiphertext({
          mediaKey: openedKey,
          sealed: { nonce: parsedManifest.sealedNonce, ciphertext: bytes },
          context,
        })
      )
    ).toBe('alice’s photo');
  });

  it('refuses an envelope for a device nobody claimed', async () => {
    const { app } = makeApp();
    await post(app, `${BASE}/device-claims`, TOKEN_A, {
      deviceId: 'device-a',
      signingPublicKey: encodeBase64(generateDeviceKeyMaterial().signingPublicKey),
      agreementPublicKey: encodeBase64(generateDeviceKeyMaterial().agreementPublicKey),
    });
    const alice = generateDeviceKeyMaterial();
    // Enrol device-a properly so the authoriser exists.
    const { put: _put } = { put };
    void _put;
    const claimKey = {
      deviceId: 'device-a',
      signingPublicKey: encodeBase64(alice.signingPublicKey),
      agreementPublicKey: encodeBase64(alice.agreementPublicKey),
    };
    await post(app, `${BASE}/device-claims`, TOKEN_A, claimKey);
    const recordInput = {
      deviceId: 'device-a',
      spaceId: SPACE_1,
      signingPublicKey: alice.signingPublicKey,
      agreementPublicKey: alice.agreementPublicKey,
      authorisedBy: { kind: 'self' as const },
      revision: 1,
      createdAt: AT,
    };
    await put(
      app,
      `${BASE}/devices/device-a`,
      TOKEN_A,
      toWireDeviceRecord({
        ...recordInput,
        authorisation: signDeviceRecord(recordInput, alice.signingPrivateKey),
      })
    );

    const response = await put(app, `${BASE}/envelopes`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 1,
      recipientDeviceId: 'device-ghost',
      authoriserDeviceId: 'device-a',
      recipientRevision: 1,
      nonce: encodeBase64(new Uint8Array(12).fill(3)),
      ciphertext: encodeBase64(new Uint8Array(48).fill(4)),
    });
    expect(response.status).toBe(400);
  });

  it('refuses an offer whose keys do not match the claim', async () => {
    const { app } = makeApp();
    const alice = generateDeviceKeyMaterial();
    const bob = generateDeviceKeyMaterial();
    const imposter = generateDeviceKeyMaterial();

    await post(app, `${BASE}/device-claims`, TOKEN_A, {
      deviceId: 'device-a',
      signingPublicKey: encodeBase64(alice.signingPublicKey),
      agreementPublicKey: encodeBase64(alice.agreementPublicKey),
    });
    const recordInput = {
      deviceId: 'device-a',
      spaceId: SPACE_1,
      signingPublicKey: alice.signingPublicKey,
      agreementPublicKey: alice.agreementPublicKey,
      authorisedBy: { kind: 'self' as const },
      revision: 1,
      createdAt: AT,
    };
    await put(
      app,
      `${BASE}/devices/device-a`,
      TOKEN_A,
      toWireDeviceRecord({
        ...recordInput,
        authorisation: signDeviceRecord(recordInput, alice.signingPrivateKey),
      })
    );
    await post(app, `${BASE}/device-claims`, TOKEN_B, {
      deviceId: 'device-b',
      signingPublicKey: encodeBase64(bob.signingPublicKey),
      agreementPublicKey: encodeBase64(bob.agreementPublicKey),
    });

    // Alice signs Bob's id but substitutes keys she holds.
    const forgedInput = {
      deviceId: 'device-b',
      spaceId: SPACE_1,
      signingPublicKey: imposter.signingPublicKey,
      agreementPublicKey: imposter.agreementPublicKey,
      authorisedBy: { kind: 'device' as const, deviceId: 'device-a' },
      revision: 1,
      createdAt: AT,
    };
    const forged = toWireDeviceRecord({
      ...forgedInput,
      authorisation: signDeviceRecord(forgedInput, alice.signingPrivateKey),
    });
    expect(
      (await put(app, `${BASE}/enrollment-offers/device-b`, TOKEN_A, forged)).status
    ).toBe(400);
  });
});
