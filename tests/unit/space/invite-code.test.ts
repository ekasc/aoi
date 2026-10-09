import { describe, it, expect } from 'vitest';

import { findInviteCode, isInviteCodeFormat, normalizeInviteCode } from '@/features/space/invite-code';

describe('finding an invite code in pasted text', () => {
  it('takes a bare code, in any case, however it is spaced', () => {
    expect(findInviteCode('HQABD7')).toBe('HQABD7');
    expect(findInviteCode('hqabd7')).toBe('HQABD7');
    expect(findInviteCode('  hq abd7  ')).toBe('HQABD7');
  });

  it('finds the code inside the sentence people actually send', () => {
    expect(findInviteCode('join me on aoi, the code is HX4TZ9')).toBe('HX4TZ9');
    expect(findInviteCode('Our space is waiting: 7KQMP2 — see you there')).toBe('7KQMP2');
  });

  it('prefers a code the generator could actually have produced', () => {
    // The alphabet has no I, O, 1 or 0, so a six-character word that does is
    // a worse guess than the one beside it that does not.
    expect(findInviteCode('ORDER1 then HQABD7')).toBe('HQABD7');
  });

  it('returns nothing rather than guessing when there is no code', () => {
    expect(findInviteCode('')).toBeNull();
    expect(findInviteCode(null)).toBeNull();
    expect(findInviteCode('hey, how are you?')).toBeNull();
    expect(findInviteCode('too short ABC')).toBeNull();
    expect(findInviteCode('too long ABCDEFG')).toBeNull();
    // A code glued to other characters is part of a longer word, not a code.
    expect(findInviteCode('prefixHQABD7suffix')).toBeNull();
  });

  it('agrees with the format check it is feeding', () => {
    const found = findInviteCode('the code is HQABD7, thanks');
    expect(found).not.toBeNull();
    expect(isInviteCodeFormat(normalizeInviteCode(found as string))).toBe(true);
  });
});
