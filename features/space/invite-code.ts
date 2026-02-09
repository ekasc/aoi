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
