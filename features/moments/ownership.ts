import type { Moment } from '@/features/moments/types';

/**
 * Ownership gate for edit/delete affordances.
 *
 * Relies on the per-request `isOwn` signal (server compares the moment's
 * author user id to the requesting user), never on `authorRole` alone — the
 * API shape can render roles inconsistently, but `isOwn` is computed per
 * request. Fallback semantics must never widen access: an unknown/missing
 * value means "not own".
 */
export function isOwnMoment(moment: Pick<Moment, 'isOwn'>): boolean {
  return moment.isOwn === true;
}
