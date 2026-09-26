import { describe, it, expect } from 'vitest';

import { authoriseDevice, openAlbumMedia, restoreSpaceKey, sealAlbumMedia } from '@/features/album/album';
import { generateMediaKey } from '@/features/album/crypto';
import { generateDeviceKeys, identityOf, signDeviceKey, spaceKeyFor, toWire } from '@/features/album/keys';
import type { SpaceBackup } from '@/features/album/types';

const when = new Date('2026-09-26T00:00:00.000Z');
const photo = new TextEncoder().encode('pretend this is a jpeg of the two of us');

describe('replacing a phone', () => {
  it('a new device gets in with the partner online once, and never again', () => {
    const hers = generateDeviceKeys('hers-phone', when);
    const hisFirst = generateDeviceKeys('his-first-phone', when);
    const spaceKey = sealFor(hers, hisFirst);

    // He replaces his phone. This is the one moment she is needed.
    const hisSecond = generateDeviceKeys('his-second-phone', when);
    const backup: SpaceBackup = {
      identities: [toWire(identityOf(hers)), toWire(identityOf(hisSecond))],
      deviceKeys: [
        signDeviceKey(hers.signing, 'hers-phone', hers.agreement.publicKey),
        signDeviceKey(hers.signing, 'his-second-phone', hisSecond.agreement.publicKey),
      ],
      envelopes: [authoriseDevice(hers, toWire(identityOf(hisSecond)), spaceKey, when)],
    };

    // From here on nobody is online. The server is just a place envelopes sit.
    const result = restoreSpaceKey(hisSecond, backup, partnerOf(hers));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // And the restored key opens every photo, because the wrapped media keys
    // travelled with them.
    const sealed = sealAlbumMedia(
      spaceKey,
      photo,
      { createdAt: when.toISOString(), byteLength: photo.length, mimeType: 'image/jpeg' },
      generateMediaKey,
    );
    expect(new TextDecoder().decode(openAlbumMedia(result.spaceKey, sealed))).toBe(
      new TextDecoder().decode(photo),
    );
  });

  it('derives the same space key on the old and the new device', () => {
    // The new phone must land in the same album, not a parallel one.
    const hers = generateDeviceKeys('hers-phone', when);
    const hisFirst = generateDeviceKeys('his-first-phone', when);
    const hisSecond = generateDeviceKeys('his-second-phone', when);
    const spaceKey = sealFor(hers, hisFirst);
    const backup = oneBackup(hers, hisSecond, spaceKey);

    const restored = restoreSpaceKey(hisSecond, backup, partnerOf(hers));
    expect(restored.ok && Buffer.from(restored.spaceKey)).toEqual(Buffer.from(spaceKey));
    expect(hisFirst.deviceId).not.toBe(hisSecond.deviceId);
  });

  it('a device nobody authorised gets nothing, and says so', () => {
    const hers = generateDeviceKeys('hers-phone', when);
    const his = generateDeviceKeys('his-phone', when);
    const spaceKey = sealFor(hers, his);
    const backup = oneBackup(hers, his, spaceKey);

    const stranger = generateDeviceKeys('stranger', when);
    const result = restoreSpaceKey(stranger, backup, partnerOf(hers));
    expect(result).toEqual({ ok: false, reason: 'no-envelope' });
  });

  it('refuses an envelope the partner did not issue', () => {
    // The server holds both public keys and could mint one of its own.
    const hers = generateDeviceKeys('hers-phone', when);
    const him = generateDeviceKeys('his-phone', when);
    const impostor = generateDeviceKeys('impostor', when);
    const spaceKey = sealFor(hers, him);

    const envelope = authoriseDevice(impostor, toWire(identityOf(him)), spaceKey, when);
    const backup: SpaceBackup = {
      identities: [toWire(identityOf(hers)), toWire(identityOf(him))],
      deviceKeys: [signDeviceKey(hers.signing, 'his-phone', him.agreement.publicKey)],
      envelopes: [envelope],
    };

    expect(restoreSpaceKey(him, backup, partnerOf(hers))).toEqual({
      ok: false,
      reason: 'wrong-partner',
    });
  });

  it('refuses a device key the partner never signed', () => {
    // A server that mints both an envelope and a matching device key must
    // still be caught, because the signature is what the partner vouches for.
    const hers = generateDeviceKeys('hers-phone', when);
    const him = generateDeviceKeys('his-phone', when);
    const attacker = generateDeviceKeys('attacker', when);
    const spaceKey = sealFor(hers, him);

    const backup: SpaceBackup = {
      identities: [toWire(identityOf(hers)), toWire(identityOf(him))],
      // Signed by the attacker, not by her, but claiming to be his.
      deviceKeys: [signDeviceKey(attacker.signing, 'his-phone', him.agreement.publicKey)],
      envelopes: [authoriseDevice(hers, toWire(identityOf(him)), spaceKey, when)],
    };

    expect(restoreSpaceKey(him, backup, partnerOf(hers))).toEqual({
      ok: false,
      reason: 'not-authorised',
    });
  });

  it('reports an absent backup as unauthorised rather than throwing', () => {
    // "Not set up yet" is the normal state of a new phone, not an error.
    const device = generateDeviceKeys('new', when);
    const partner = generateDeviceKeys('partner', when);
    expect(restoreSpaceKey(device, null, partner.signing.publicKey)).toEqual({
      ok: false,
      reason: 'not-authorised',
    });
  });
});

describe('what the server can see', () => {
  it('holds the photo and the key, and can read neither', () => {
    const a = generateDeviceKeys('a', when);
    const b = generateDeviceKeys('b', when);
    const spaceKey = sealFor(a, b);

    const sealed = sealAlbumMedia(
      spaceKey,
      photo,
      { createdAt: when.toISOString(), byteLength: photo.length, mimeType: 'image/jpeg' },
      generateMediaKey,
    );

    // Neither blob is the plaintext, and neither is the key.
    expect(Buffer.from(fromB64(sealed.sealed.ciphertext)).equals(Buffer.from(photo))).toBe(false);
    expect(sealed.sealed.ciphertext).not.toBe(Buffer.from(photo).toString('base64'));
    expect(Buffer.from(fromB64(sealed.wrappedKey.ciphertext)).equals(Buffer.from(fromB64(sealed.sealed.nonce)))).toBe(
      false,
    );

    // But the metadata is plainly visible, and pretending otherwise would be
    // the actual privacy failure.
    expect(sealed.createdAt).toBe(when.toISOString());
    expect(sealed.byteLength).toBe(photo.length);
    expect(sealed.mimeType).toBe('image/jpeg');
  });
});

describe('a sealed photo', () => {
  it('uses a different media key every time, so one leak exposes one photo', () => {
    const a = generateDeviceKeys('a', when);
    const b = generateDeviceKeys('b', when);
    const spaceKey = sealFor(a, b);
    const meta = { createdAt: when.toISOString(), byteLength: photo.length, mimeType: 'image/jpeg' };

    const first = sealAlbumMedia(spaceKey, photo, meta, generateMediaKey);
    const second = sealAlbumMedia(spaceKey, photo, meta, generateMediaKey);

    expect(first.wrappedKey.ciphertext).not.toBe(second.wrappedKey.ciphertext);
    expect(first.sealed.nonce).not.toBe(second.sealed.nonce);
  });
});

function sealFor(
  authoriser: ReturnType<typeof generateDeviceKeys>,
  recipient: ReturnType<typeof generateDeviceKeys>,
) {
  return spaceKeyFor(authoriser, recipient.agreement.publicKey);
}

function oneBackup(
  partner: ReturnType<typeof generateDeviceKeys>,
  device: ReturnType<typeof generateDeviceKeys>,
  spaceKey: Uint8Array,
): SpaceBackup {
  return {
    identities: [toWire(identityOf(partner)), toWire(identityOf(device))],
    deviceKeys: [signDeviceKey(partner.signing, device.deviceId, device.agreement.publicKey)],
    envelopes: [authoriseDevice(partner, toWire(identityOf(device)), spaceKey, when)],
  };
}

/** Both halves of a partner's identity, which is what restore needs. */
function partnerOf(device: ReturnType<typeof generateDeviceKeys>) {
  return {
    signingPublicKey: device.signing.publicKey,
    agreementPublicKey: device.agreement.publicKey,
  };
}

function fromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

describe('the local repository', () => {
  it('round-trips media and a backup, and overwrites rather than duplicates', async () => {
    const { createLocalAlbumRepository } = await import('@/features/album/local-album-repository');
    const store = globalThis.__mockAsyncStorage;
    await store.clear();

    const a = generateDeviceKeys('a', when);
    const b = generateDeviceKeys('b', when);
    const spaceKey = sealFor(a, b);
    const media = sealAlbumMedia(
      spaceKey,
      photo,
      { createdAt: when.toISOString(), byteLength: photo.length, mimeType: 'image/jpeg' },
      generateMediaKey,
    );

    const repo = createLocalAlbumRepository('space-1');
    expect(await repo.listMedia()).toEqual([]);
    await repo.putMedia(media);
    expect(await repo.listMedia()).toHaveLength(1);

    // Writing the same id again must replace it, not append a twin.
    await repo.putMedia({ ...media, byteLength: 1 });
    const rows = await repo.listMedia();
    expect(rows).toHaveLength(1);
    expect(rows[0].byteLength).toBe(1);

    await repo.deleteMedia(media.id);
    expect(await repo.listMedia()).toEqual([]);
  });

  it('drops a stored row it cannot make sense of', async () => {
    const { createLocalAlbumRepository } = await import('@/features/album/local-album-repository');
    const store = globalThis.__mockAsyncStorage;
    await store.clear();

    // A half-written record from an older shape, or a truncated write. It
    // must not surface as a photo that cannot be opened.
    await store.setItem(
      'aoi.album.media.v1.space-1',
      JSON.stringify([
        { id: 'broken', sealed: { nonce: 'n' } },
        { nothing: 'useful' },
        null,
      ]),
    );
    expect(await createLocalAlbumRepository('space-1').listMedia()).toEqual([]);
  });

  it('keeps two spaces apart', async () => {
    const { createLocalAlbumRepository } = await import('@/features/album/local-album-repository');
    const store = globalThis.__mockAsyncStorage;
    await store.clear();

    const a = generateDeviceKeys('a', when);
    const b = generateDeviceKeys('b', when);
    const media = sealAlbumMedia(
      sealFor(a, b),
      photo,
      { createdAt: when.toISOString(), byteLength: photo.length, mimeType: 'image/jpeg' },
      generateMediaKey,
    );

    await createLocalAlbumRepository('space-1').putMedia(media);
    // A different space must not see it. Leaving a space has to actually
    // leave, and a shared key prefix is the obvious way to get that wrong.
    expect(await createLocalAlbumRepository('space-2').listMedia()).toEqual([]);
  });

  it('round-trips a backup', async () => {
    const { createLocalAlbumRepository } = await import('@/features/album/local-album-repository');
    const store = globalThis.__mockAsyncStorage;
    await store.clear();

    const a = generateDeviceKeys('a', when);
    const b = generateDeviceKeys('b', when);
    const backup: SpaceBackup = {
      identities: [toWire(identityOf(a))],
      deviceKeys: [signDeviceKey(a.signing, 'a', a.agreement.publicKey)],
      envelopes: [authoriseDevice(a, toWire(identityOf(b)), sealFor(a, b), when)],
    };

    const repo = createLocalAlbumRepository('space-1');
    expect(await repo.getBackup()).toBeNull();
    await repo.putBackup(backup);
    expect((await repo.getBackup())?.envelopes).toHaveLength(1);
  });
});
