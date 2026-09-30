const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeInviteCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isInviteCodeFormat(value: string) {
  return /^[A-Z0-9]{6}$/.test(normalizeInviteCode(value));
}

export function createInviteCode() {
  let result = '';

  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    const alphabetIndex = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
    result += INVITE_CODE_ALPHABET[alphabetIndex];
  }

  return result;
}

/**
 * The invite code inside a piece of text, if there is one.
 *
 * The message people paste is a sentence with the code buried in it ("join me
 * on aoi, the code is HQABD7"), so demanding the clipboard hold nothing but a
 * code would reject exactly what arrives. Six characters standing on their
 * own is the shape to look for; a code drawn from the generator's alphabet
 * (no I, O, 1 or 0) wins over an ambiguous neighbour, because that is what
 * the generator can actually produce.
 */
export function findInviteCode(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const upper = text.toUpperCase();
  // A message that is *only* the code, however it was punctuated or spaced:
  // "  hq abd7  " and "HQ-ABD7" are both just the code, and the reader can see
  // that, so we should too.
  const bare = upper.replace(/[^A-Z0-9]/g, '');
  if (bare.length === INVITE_CODE_LENGTH) {
    return bare;
  }
  // Otherwise the code is a word inside a sentence. Six characters standing on
  // their own is the shape to look for; a code drawn from the generator's
  // alphabet (no I, O, 1 or 0) wins over an ambiguous neighbour, because that
  // is what the generator can actually produce.
  const candidates = upper
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length === INVITE_CODE_LENGTH);
  if (candidates.length === 0) {
    return null;
  }
  const fromGeneratorAlphabet = candidates.find((token) =>
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(token)
  );
  return fromGeneratorAlphabet ?? candidates[0];
}
