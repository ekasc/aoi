import { describe, expect, it } from 'vitest';

import {
  checkPartnerName,
  isPartnerName,
  parsePartnerName,
  spaceNameForPair,
  PARTNER_NAME_MAX,
  PARTNER_NAME_MESSAGES,
} from '@/features/space/partner-name';

describe('partner name', () => {
  it('accepts a name and refuses everything that is not one', () => {
    expect(isPartnerName('June')).toBe(true);
    expect(isPartnerName('')).toBe(false);
    // Whitespace is not a name. This is the case that produced a space whose
    // first empty feed greeted the reader with "For you."
    expect(isPartnerName('   ')).toBe(false);
    expect(isPartnerName('\n\t ')).toBe(false);
  });

  it('says which rule was broken, not just that one was', () => {
    // A refusal without a reason leaves the reader guessing which field the
    // screen wanted, so the problem travels with the verdict.
    expect(checkPartnerName('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkPartnerName('   ')).toEqual({ ok: false, problem: 'empty' });
    // Not typeable — the field caps it — but a paste can carry it, so the rule
    // is real and the message is worded for the person who hits it.
    expect(checkPartnerName('J'.repeat(PARTNER_NAME_MAX + 1))).toEqual({
      ok: false,
      problem: 'tooLong',
    });
    expect(checkPartnerName('June')).toEqual({ ok: true, name: 'June' });
  });

  it('has wording for every problem it can report', () => {
    // A union with no message behind one of its cases is the bug this file
    // exists to prevent, so it is pinned rather than trusted.
    for (const problem of ['empty', 'tooLong'] as const) {
      expect(PARTNER_NAME_MESSAGES[problem]).toBeTruthy();
    }
  });

  it('parses to a trimmed name, or to null', () => {
    // Trimming matters: a stored name reaches headings and comparisons, so the
    // trailing space a keyboard leaves must not survive into it.
    expect(parsePartnerName('  June  ')).toBe('June');
    expect(parsePartnerName('June')).toBe('June');
    expect(parsePartnerName('  ')).toBeNull();
    expect(parsePartnerName('')).toBeNull();
  });

  it('names the space after the pair, so no screen has to invent a default', () => {
    const june = parsePartnerName('June');
    expect(june).not.toBeNull();
    expect(spaceNameForPair('Maya', june as NonNullable<typeof june>)).toBe('Maya & June');
  });
});
