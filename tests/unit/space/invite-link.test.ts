import { describe, expect, it } from 'vitest';

import {
  findInviteCode,
  inviteAppLink,
  inviteCodeFromLink,
  inviteMessage,
  inviteWebLink,
} from '@/features/space/invite-code';

describe('invite links', () => {
  it('builds both forms of the link from one code', () => {
    // The custom scheme is what opens the app. The universal link is for a
    // phone that will not run one, which is the person most likely to be
    // receiving an invite in the first place.
    expect(inviteAppLink('hqa bd7')).toBe('aoi://join?code=HQABD7');
    expect(inviteWebLink('hqa bd7')).toBe('https://aoi.app/join?code=HQABD7');
  });

  it('says the code in the message, so a link that fails to open is not a dead end', () => {
    const message = inviteMessage('HQABD7', 'Maya', 'June');
    expect(message).toContain('June, Maya invited you');
    expect(message).toContain(inviteAppLink('HQABD7'));
    // Spaced out, the way the code screen spells it, so it can be read aloud
    // or typed without re-deriving the letters.
    expect(message).toContain('H Q A B D 7');
  });

  it('omits the greeting when the partner was never named', () => {
    expect(inviteMessage('HQABD7', 'Maya', null)).toMatch(/^Maya invited you/);
    expect(inviteMessage('HQABD7', 'Maya', '   ')).toMatch(/^Maya invited you/);
  });

  it('reads the code back out of both link forms', () => {
    expect(inviteCodeFromLink(inviteAppLink('HQABD7'))).toBe('HQABD7');
    expect(inviteCodeFromLink(inviteWebLink('HQABD7'))).toBe('HQABD7');
  });

  it('tolerates what a real link does on the way there', () => {
    // iOS can hand the scheme over upper-cased.
    expect(inviteCodeFromLink('AOI://join?code=HQABD7')).toBe('HQABD7');
    // A code that kept its spaces, and a lower-cased one.
    expect(inviteCodeFromLink('aoi://join?code=hq%20abd7')).toBe('HQABD7');
    // A redirect that flattened the query into the path.
    expect(inviteCodeFromLink('https://aoi.app/join/HQABD7')).toBe('HQABD7');
  });

  it('ignores links that are not ours, and links with no code in them', () => {
    expect(inviteCodeFromLink('https://example.com/join?code=HQABD7')).toBeNull();
    expect(inviteCodeFromLink('aoi://somewhere-else?code=HQABD7')).toBeNull();
    expect(inviteCodeFromLink('aoi://join')).toBeNull();
    expect(inviteCodeFromLink('aoi://join?code=nope')).toBeNull();
    expect(inviteCodeFromLink('')).toBeNull();
    expect(inviteCodeFromLink(null)).toBeNull();
    expect(inviteCodeFromLink(undefined)).toBeNull();
  });

  it('still finds a code pasted from any message, which is the original case', () => {
    // The link is the better path, not the only one: a code in plain text
    // still works, because that is what someone types when a link does not open.
    expect(findInviteCode(`here you go ${inviteAppLink('HQABD7')}`)).toBe('HQABD7');
  });
});
