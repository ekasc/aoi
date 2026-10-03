import { describe, expect, it, beforeEach } from 'vitest';

import { publishInvite, takeInvite } from '@/features/space/invite-handoff';
import { inviteCodeFromLink } from '@/features/space/invite-code';

describe('invite handoff', () => {
  beforeEach(() => {
    // Drain anything a previous test left, so the store starts empty.
    takeInvite();
  });

  it('hands the code over once and then forgets it', () => {
    publishInvite('HQABD7');
    expect(takeInvite()).toBe('HQABD7');
    // The point of clearing: a second mount must not refill a field the reader
    // has since emptied, and a reload must not replay an acted-on invite.
    expect(takeInvite()).toBeNull();
  });

  it('a second link replaces the first, because that is what tapping it meant', () => {
    publishInvite('AAAAAA');
    publishInvite('BBBBBB');
    expect(takeInvite()).toBe('BBBBBB');
  });

  it('round-trips a real link through the route and the field', () => {
    // The shape the app actually takes: a link arrives, the route hands it on,
    // and the flow ends up holding the code it carried.
    const url = 'aoi://join?code=HQABD7';
    publishInvite(inviteCodeFromLink(url) as string);
    expect(takeInvite()).toBe('HQABD7');
  });
});
