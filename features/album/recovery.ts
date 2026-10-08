import { entropyToMnemonic, generateMnemonic, mnemonicToEntropy } from '@scure/bip39';// Pinned in-repo rather than read from the package. See that file for why:
// a wordlist that can change underneath a phrase someone wrote on paper is a
// way to lose an archive quietly. It is also the only language offered,
// because a phrase typed on a keyboard in two languages is a phrase that
// gets mistyped and lost.
import { ENGLISH_WORDLIST } from '@/features/album/wordlist';

// The upstream helpers declare a mutable list; ours is frozen on purpose so
// nothing can edit the words a written-down phrase depends on.
const wordlist: string[] = [...ENGLISH_WORDLIST];

import { spaceKeyFromRecoverySeed } from '@/features/album/crypto';

/**
 * The one recovery path, for the case where both phones are gone.
 *
 * Losing one phone is handled by the server holding an unreadable backup.
 * Losing both is not handled by anything else in this design, because
 * "the server cannot read it" and "the server can get it back for you" are
 * the same sentence said twice. So this exists to cover the one case the
 * rest cannot, and there is deliberately only one of it.
 *
 * Offered, not required. It is a secret that can be written down, which is
 * both its value and its risk, and forcing ceremony on a rare case is a
 * cost paid by everyone for the benefit of a few.
 */
export const RECOVERY_WORDS = 24;

export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/**
 * The 32 bytes behind a typed phrase.
 *
 * Rejects anything that is not exactly a valid 24-word phrase rather than
 * coercing it, because a near-miss here produces a *different but valid*
 * entropy value, and the symptom would be an empty archive with no error
 * anywhere — indistinguishable from data loss.
 */
export function recoveryEntropyFromPhrase(phrase: string): Uint8Array {
  const normalised = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  const words = normalised.split(' ');
  if (words.length !== RECOVERY_WORDS) {
    throw new Error(`A recovery phrase is ${RECOVERY_WORDS} words. That was ${words.length}.`);
  }
  let entropy: Uint8Array;
  try {
    entropy = mnemonicToEntropy(normalised, wordlist);
  } catch {
    // Deliberately vague: telling an attacker which word was wrong is a
    // free oracle, and telling the user "check your phrase" is enough.
    throw new Error('That is not a valid recovery phrase. Check it and try again.');
  }
  if (entropy.length !== 32) {
    throw new Error('That recovery phrase is the wrong length for this album.');
  }
  return entropy;
}

/**
 * Turn a typed phrase into a space key.
 *
 * The old derivation, kept because the old protocol still uses it. The new
 * protocol treats the phrase as a key-encryption key instead: it derives a wrap
 * key and a signing key from the same entropy and uses them against the stable
 * Space key, so recovery restores an archive rather than starting a new one.
 */
export function spaceKeyFromPhrase(phrase: string): Uint8Array {
  return spaceKeyFromRecoverySeed(recoveryEntropyFromPhrase(phrase));
}

/** Group the words so a phrase can be written down, and read back reliably. */
export function formatPhraseForDisplay(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ').split(' ').join(' ');
}

/**
 * The phrase for entropy this device already holds.
 *
 * The inverse of `recoveryEntropyFromPhrase`, and the only way a creator can
 * ever see the phrase it generated: the entropy is what is stored, and the
 * words are a rendering of it. Round-tripping is asserted in the tests, because
 * a rendering that does not decode back to the same entropy is a phrase that
 * silently restores nothing.
 */
export function phraseFromRecoveryEntropy(entropy: Uint8Array): string {
  if (entropy.length !== 32) {
    throw new Error('Recovery entropy must be 32 bytes');
  }
  return entropyToMnemonic(entropy, wordlist);
}
