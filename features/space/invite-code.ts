const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The app's link scheme, and the universal link that reaches the same place.
 *
 * A custom scheme is what a phone without the app installed will refuse, which
 * is the case that matters: the person receiving an invite is the one who may
 * not have aoi yet. So a shared invite carries both, and the message says the
 * code in words too, so a link that never opens still leaves them able to join.
 *
 * The universal link's host is a placeholder until aoi has a domain. It is
 * parsed here so the shape is pinned by a test rather than discovered on
 * someone's phone; until the domain exists, the custom scheme is the one that
 * works.
 */
export const INVITE_LINK_SCHEME = 'aoi';
export const INVITE_LINK_HOST = 'join';
export const INVITE_UNIVERSAL_HOST = 'aoi.app';

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

/** The custom-scheme link, which is what opens the app when it is installed. */
export function inviteAppLink(code: string): string {
  return `${INVITE_LINK_SCHEME}://${INVITE_LINK_HOST}?code=${encodeURIComponent(normalizeInviteCode(code))}`;
}

/** The universal link, for a phone that would rather not run a custom scheme. */
export function inviteWebLink(code: string): string {
  return `https://${INVITE_UNIVERSAL_HOST}/${INVITE_LINK_HOST}?code=${encodeURIComponent(normalizeInviteCode(code))}`;
}

/**
 * Both links, and the sentence to send with them.
 *
 * The message carries the code in plain words as well as in both links,
 * because a link that does not open is still a message someone can read, and a
 * person who cannot get in from it can type six characters. Nothing about
 * joining depends on the link working.
 */
export function inviteMessage(code: string, yourName: string, partnerName: string | null): string {
  const normalized = normalizeInviteCode(code);
  const who = partnerName?.trim() ? `${partnerName.trim()}, ` : '';
  return [
    `${who}${yourName} invited you to their space on aoi.`,
    '',
    `Open the link and it will bring you straight here.`,
    `${inviteAppLink(normalized)}`,
    '',
    `Or enter the code ${normalized.split('').join(' ')} in aoi.`,
  ].join('\n');
}

/**
 * The code inside a link, if it is one of ours.
 *
 * Reads both the custom scheme and the universal form, and is tolerant about
 * the parts that are not ours: a host can arrive upper-cased on iOS, and a link
 * can have arrived with the code spelled with spaces. A link we do not
 * recognise yields null, and the caller falls back to reading the clipboard.
 */
export function inviteCodeFromLink(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const trimmed = url.trim();
  const lowered = trimmed.toLowerCase();
  const isAppLink = lowered.startsWith(`${INVITE_LINK_SCHEME}://`);
  const isWebLink = lowered.startsWith(`https://${INVITE_UNIVERSAL_HOST}/`);
  if (!isAppLink && !isWebLink) {
    return null;
  }
  // The path has to be ours too. A custom scheme puts the route in the host
  // position, so `aoi://settings?code=HQABD7` is a real URL that is not an
  // invite, and reading a code out of it would be inventing one.
  const afterScheme = lowered.slice(`${INVITE_LINK_SCHEME}://`.length);
  const afterHost = lowered.slice(`https://${INVITE_UNIVERSAL_HOST}/`.length);
  const route = isAppLink ? afterScheme.split(/[/?#]/)[0] : afterHost.split(/[/?#]/)[0];
  if (route !== INVITE_LINK_HOST) {
    return null;
  }
  // Take the query string, then the last path segment: the custom scheme puts
  // the code in the query, and a universal link carries it there too, but a
  // redirect can flatten it into the path.
  const queryStart = trimmed.indexOf('?');
  const query = queryStart === -1 ? '' : trimmed.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  const fromQuery = params.get('code');
  if (fromQuery && isInviteCodeFormat(fromQuery)) {
    return normalizeInviteCode(fromQuery);
  }
  const path = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart);
  const lastSegment = path.split('/').filter(Boolean).pop() ?? '';
  return isInviteCodeFormat(lastSegment) ? normalizeInviteCode(lastSegment) : null;
}
