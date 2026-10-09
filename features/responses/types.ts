import type { MomentAuthorRole } from '@/features/moments/types';
import type { MomentResponse, MomentResponseKind } from '@aoi/shared';

export type { MomentResponse, MomentResponseKind, MomentResponseListResponse } from '@aoi/shared';
export { RESPONSE_BODY_MAX_LENGTH } from '@aoi/shared';

/**
 * A response to a memory: one person reacting to something the two of them
 * kept. This is the whole mechanism the Us screen is built on, so the shape
 * of it is the most important decision in the feature.
 *
 * Why it exists, in one line: research on reminiscing distinguishes sharply
 * between looking at your own history alone and doing it *together*, and only
 * the second moves anything. Alone, nostalgia is a short-term emotional
 * regulation effect whose association with satisfaction reverses over time.
 * Together, it raises closeness and perceived support for both partners, and
 * one partner's state after it predicts the other's satisfaction.
 *
 * That is the entire reason a memory can have a response at all.
 */

/**
 * How the response was made. A discriminated union rather than three
 * nullable fields, so "a word with no words in it" is not representable.
 *
 * The order is the priority order of the capture sheet, and it is deliberate:
 * `tap` and `photo` come first because the people who will not write
 * anything are the people this feature most needs to hear from. Words are
 * the third option, not the first.
 */

/** Narrow a response to the variant that carries words. */
export function responseWords(
  response: MomentResponse,
): response is MomentResponse & { kind: 'word'; body: string } {
  return response.kind === 'word' && Boolean(response.body && response.body.trim());
}

/**
 * What each variant is called in the UI. Kept next to the type because the
 * label is the product decision: a response should never read as homework,
 * so nothing here is called a "note" or a "comment".
 */
export const RESPONSE_LABELS: Record<MomentResponseKind, string> = {
  tap: 'was there',
  photo: 'added a photo',
  voice: 'sent a voice note',
  word: 'wrote',
};

/** What the capture sheet can send. Mirrors `MomentResponseKind`. */
export type CreateMomentResponseInput = {
  momentId: string;
  authorId: string;
  authorRole: MomentAuthorRole;
  authorName: string;
  kind: MomentResponseKind;
  body?: string;
  mediaPreview?: string;
  audioUri?: string;
  mimeType?: string;
};

export type MomentResponseRepository = {
  listForMoment: (momentId: string) => Promise<MomentResponse[]>;
  add: (input: CreateMomentResponseInput, assertScope?: () => void) => Promise<MomentResponse>;
};
