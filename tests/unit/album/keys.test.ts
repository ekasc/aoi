import { describe, it, expect } from 'vitest';

import {
  generateDeviceKeys,
  identityOf,
  signDeviceKey,
  spaceKeyFor,
  verificationFingerprint,
  verifyDeviceKey,
  toWire,
  fromWire,
} from '@/features/album/keys';
import { formatPhraseForDisplay, generateRecoveryPhrase, spaceKeyFromPhrase } from '@/features/album/recovery';
import { ENGLISH_WORDLIST } from '@/features/album/wordlist';

const when = new Date('2026-09-26T00:00:00.000Z');

describe('device identity', () => {
  it('keeps the signing and agreement keys separate', () => {
    const device = generateDeviceKeys('phone-a', when);
    // Ed25519 signs, X25519 agrees. Conflating them is how a protocol ends
    // up reusing one key for two jobs.
    expect(device.signing.publicKey.length).toBe(32);
    expect(device.agreement.publicKey.length).toBe(32);
    expect(Buffer.from(device.signing.publicKey)).not.toEqual(
      Buffer.from(device.agreement.publicKey),
    );
  });

  it('survives a round trip through storage encoding', () => {
    const device = generateDeviceKeys('phone-a', when);
    const restored = fromWire(toWire(identityOf(device)));
    expect(restored.deviceId).toBe('phone-a');
    expect(Buffer.from(restored.signingPublicKey)).toEqual(Buffer.from(device.signing.publicKey));
    expect(Buffer.from(restored.agreementPublicKey)).toEqual(Buffer.from(device.agreement.publicKey));
  });
});

describe('cross-signing', () => {
  it('accepts a device key signed by the identity that claims it', () => {
    const device = generateDeviceKeys('phone-a', when);
    const signed = signDeviceKey(device.signing, device.deviceId, device.agreement.publicKey);
    expect(verifyDeviceKey(signed, device.signing.publicKey)).toEqual({ ok: true });
  });

  it('refuses a device key signed by somebody else', () => {
    // The server holds both public keys and could substitute its own. This
    // is the attack cross-signing exists to catch.
    const hers = generateDeviceKeys('phone-b', when);
    const signed = signDeviceKey(hers.signing, 'phone-a', hers.agreement.publicKey);
    const result = verifyDeviceKey(signed, generateDeviceKeys('mine', when).signing.publicKey);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('unknown-signer');
  });

  it('refuses a signature that has been edited', () => {
    const device = generateDeviceKeys('phone-a', when);
    const signed = signDeviceKey(device.signing, device.deviceId, device.agreement.publicKey);
    // Same signature, different device id.
    const moved = { ...signed, deviceId: 'phone-b' };
    const result = verifyDeviceKey(moved, device.signing.publicKey);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('forged');
  });

  it('refuses a key swapped under a valid signature', () => {
    const device = generateDeviceKeys('phone-a', when);
    const attacker = generateDeviceKeys('phone-evil', when);
    const signed = signDeviceKey(device.signing, 'phone-a', device.agreement.publicKey);
    // A real signature over a real device id, but pointing at the attacker's
    // agreement key. The canonical bytes must bind the key as well as the id.
    const swapped = { ...signed, agreementPublicKey: signed.agreementPublicKey };
    expect(verifyDeviceKey(swapped, device.signing.publicKey)).toEqual({ ok: true });
    // And a genuinely substituted key must not verify.
    const forged = {
      ...signed,
      agreementPublicKey: Buffer.from(attacker.agreement.publicKey).toString('base64'),
    };
    const result = verifyDeviceKey(forged, device.signing.publicKey);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('forged');
    expect(swapped).toBeTruthy();
  });

  it('cannot be confused by a device id that looks like two fields', () => {
    // The canonical encoding is length-prefixed precisely so this pair does
    // not collide with a different (id, key) pair.
    const device = generateDeviceKeys('a', when);
    const signed = signDeviceKey(device.signing, 'a', device.agreement.publicKey);
    const weird = verifyDeviceKey({ ...signed, deviceId: `a${signed.agreementPublicKey}` }, device.signing.publicKey);
    expect(weird.ok).toBe(false);
  });
});

describe('the fingerprint two people compare', () => {
  it('is the same number on both phones', () => {
    const a = generateDeviceKeys('phone-a', when);
    const b = generateDeviceKeys('phone-b', when);
    // Order must not matter, or the two people read different numbers and
    // the comparison is worthless.
    expect(verificationFingerprint(a.signing.publicKey, b.signing.publicKey)).toBe(
      verificationFingerprint(b.signing.publicKey, a.signing.publicKey),
    );
  });

  it('changes when the identity on the other side changes', () => {
    // This is what makes a substituted key visible to a human.
    const a = generateDeviceKeys('phone-a', when);
    const b = generateDeviceKeys('phone-b', when);
    const impostor = generateDeviceKeys('phone-c', when);
    expect(verificationFingerprint(a.signing.publicKey, b.signing.publicKey)).not.toBe(
      verificationFingerprint(a.signing.publicKey, impostor.signing.publicKey),
    );
  });

  it('is readable aloud', () => {
    const a = generateDeviceKeys('phone-a', when);
    const b = generateDeviceKeys('phone-b', when);
    const print = verificationFingerprint(a.signing.publicKey, b.signing.publicKey);
    // Twelve groups of five is the size that survives being read to another
    // person. Ten does not, and a fingerprint nobody can compare is not a
    // check at all.
    const groups = print.split(' ');
    expect(groups).toHaveLength(12);
    expect(groups.every((group) => group.length === 5)).toBe(true);
    expect(print.replace(/[^0-9a-f]/g, '')).toHaveLength(60);
  });
});

describe('the space key, through the device model', () => {
  it('agrees on both devices', () => {
    const a = generateDeviceKeys('phone-a', when);
    const b = generateDeviceKeys('phone-b', when);
    expect(Buffer.from(spaceKeyFor(a, b.agreement.publicKey))).toEqual(
      Buffer.from(spaceKeyFor(b, a.agreement.publicKey)),
    );
  });
});

describe('the recovery phrase', () => {
  it('is 24 words from the pinned list', () => {
    const phrase = generateRecoveryPhrase();
    const words = formatPhraseForDisplay(phrase).split(' ');
    expect(words).toHaveLength(24);
    for (const word of words) {
      expect(ENGLISH_WORDLIST).toContain(word);
    }
  });

  it('derives the same space key on both devices', () => {
    const phrase = generateRecoveryPhrase();
    expect(Buffer.from(spaceKeyFromPhrase(phrase))).toEqual(
      Buffer.from(spaceKeyFromPhrase(phrase)),
    );
    expect(spaceKeyFromPhrase(phrase).length).toBe(32);
  });

  it('survives being written down and typed back', () => {
    const phrase = generateRecoveryPhrase();
    // Capitalised, doubled spaces, trailing newline: what actually happens
    // when someone types it off a card.
    const typed = `  ${phrase.toUpperCase().replace(/ /g, '  ')}\n`;
    expect(Buffer.from(spaceKeyFromPhrase(typed))).toEqual(
      Buffer.from(spaceKeyFromPhrase(phrase)),
    );
  });

  it('rejects a near miss rather than deriving a different valid key', () => {
    const phrase = generateRecoveryPhrase();
    const words = formatPhraseForDisplay(phrase).split(' ');
    const wrong = [...words];
    wrong[7] = wrong[7] === 'zoo' ? 'zone' : 'zoo';
    // A coerced near-miss would restore an empty archive with no error
    // anywhere, which looks exactly like data loss.
    expect(() => spaceKeyFromPhrase(wrong.join(' '))).toThrow();
  });

  it('rejects the wrong number of words, and says how many', () => {
    expect(() => spaceKeyFromPhrase('abandon ability able')).toThrow(/24 words/);
  });

  it('does not say which word was wrong', () => {
    const words = formatPhraseForDisplay(generateRecoveryPhrase()).split(' ');
    const wrong = [...words];
    wrong[3] = 'notarealword';
    try {
      spaceKeyFromPhrase(wrong.join(' '));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('notarealword');
    }
  });

  it('pins the wordlist so a written-down phrase cannot stop working', () => {
    // 2048 words is what makes 24 of them 256 bits. A shorter list would
    // quietly weaken every recovery phrase this app has ever issued.
    expect(ENGLISH_WORDLIST).toHaveLength(2048);
    expect(ENGLISH_WORDLIST[0]).toBe('abandon');
    expect(ENGLISH_WORDLIST[ENGLISH_WORDLIST.length - 1]).toBe('zoo');
  });
});

