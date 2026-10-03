/**
 * A partner's name, as a type and as a verdict.
 *
 * Every screen that greets the partner — the sky's calendar, the first empty
 * feed, the joined beat — needs a real name. A plain `string` lets an empty
 * one through and each of those screens then has to invent something, which is
 * how the archive came to say "For you." to the person holding the phone.
 *
 * The second thing this file owns is *why* a name was refused. A boolean can
 * only say yes or no, and a reader standing in front of an empty field needs
 * the third answer: which rule they broke. So validation here is a
 * discriminated union carrying a problem, and the wording lives in one place
 * beside it rather than being invented at each call site.
 */

/** Matches the title page's field limit, which is the one that shaped it. */
export const PARTNER_NAME_MAX = 40;

/** A name that passed validation. Cannot be constructed empty. */
export type PartnerName = string & { readonly __brand: 'PartnerName' };

/**
 * The ways a name can fail. `empty` covers whitespace-only input, which is the
 * case that actually reached the product. `tooLong` cannot be typed (the field
 * caps it) but can arrive by paste, so the rule exists rather than the
 * possibility.
 */
export type PartnerNameProblem = 'empty' | 'tooLong';

export type PartnerNameCheck =
  | { ok: true; name: PartnerName }
  | { ok: false; problem: PartnerNameProblem };

/** The one place a refusal is worded. Change it here and it changes everywhere. */
export const PARTNER_NAME_MESSAGES: Record<PartnerNameProblem, string> = {
  empty: 'This space needs their name',
  tooLong: `Keep it to ${PARTNER_NAME_MAX} characters`,
};

/** True when the trimmed value could be a name. Whitespace alone is not one. */
export function isPartnerName(value: string): boolean {
  return checkPartnerName(value).ok;
}

/**
 * The verdict, with the reason when there is one.
 *
 * Trimming happens here rather than at the call sites: a stored name must
 * never carry the trailing space a keyboard leaves behind, because that name
 * reaches headings and string comparisons.
 */
export function checkPartnerName(value: string): PartnerNameCheck {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  if (trimmed.length > PARTNER_NAME_MAX) {
    return { ok: false, problem: 'tooLong' };
  }
  return { ok: true, name: trimmed as PartnerName };
}

/** The name to store, or null when the input is not one. */
export function parsePartnerName(value: string): PartnerName | null {
  const check = checkPartnerName(value);
  return check.ok ? check.name : null;
}

/** The space's display name for a pair. Both sides are already valid. */
export function spaceNameForPair(yourName: string, partnerName: PartnerName): string {
  return `${yourName} & ${partnerName}`;
}
