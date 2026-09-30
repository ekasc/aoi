import { describe, expect, it } from 'vitest';

import { deriveFirstPage, firstPageKey } from '@/features/moments/first-page';
import type { Moment } from '@/features/moments/types';
import { PREVIEW_SPACE } from '@/features/dev/preview';

const space = PREVIEW_SPACE.space;
const input = { space, viewerId: 'preview-maya', moments: [], pendingCount: 0, ready: true, dismissed: false };
function memory(authorId: string, id = 'welcome', createdAt = '2026-09-30T00:00:00.000Z'): Moment {
  return { id, authorId, authorName: 'Maya', authorRole: 'partner', body: 'This made me think of you.',
    title: '', type: 'trace', occurredAt: createdAt, createdAt };
}

describe('first page', () => {
  it('offers a dedication in an empty space, without requiring pairing', () => {
    expect(deriveFirstPage(input)).toEqual({ kind: 'dedication', partnerName: 'June', waiting: false });
    expect(deriveFirstPage({ ...input, space: space ? { ...space, partnerJoined: false } : null })).toEqual({
      kind: 'dedication', partnerName: 'June', waiting: true,
    });
  });
  it('does not call a loading, failed, or unsent archive empty', () => {
    expect(deriveFirstPage({ ...input, ready: false })).toEqual({ kind: 'quiet' });
    expect(deriveFirstPage({ ...input, pendingCount: 1 })).toEqual({ kind: 'quiet' });
  });
  it('respects a skipped invitation and missing membership', () => {
    expect(deriveFirstPage({ ...input, dismissed: true })).toEqual({ kind: 'quiet' });
    expect(deriveFirstPage({ ...input, viewerId: null })).toEqual({ kind: 'quiet' });
    expect(deriveFirstPage({ ...input, space: null })).toEqual({ kind: 'quiet' });
  });
  it('welcomes the joiner with the latest creator contribution, not the whole archive', () => {
    expect(deriveFirstPage({ ...input, viewerId: 'preview-june', moments: [
      memory('preview-maya', 'older', '2026-09-29T00:00:00.000Z'), memory('preview-maya'),
    ] })).toEqual({ kind: 'welcome', momentId: 'welcome', authorName: 'Maya' });
  });
  it('does not introduce the creator to their own contribution or ask a returning writer to begin', () => {
    expect(deriveFirstPage({ ...input, moments: [memory('preview-maya')] })).toEqual({ kind: 'quiet' });
    expect(deriveFirstPage({ ...input, viewerId: 'preview-june', moments: [memory('preview-maya'), memory('preview-june')] })).toEqual({ kind: 'quiet' });
    expect(deriveFirstPage({ ...input, viewerId: 'preview-june', moments: [{ ...memory('user_you'), isOwn: true }] })).toEqual({ kind: 'quiet' });
  });
  it('keeps choices separate for each person and space', () => {
    expect(firstPageKey('maya', 'one')).not.toBe(firstPageKey('june', 'one'));
    expect(firstPageKey('maya', 'one')).not.toBe(firstPageKey('maya', 'two'));
    expect(firstPageKey('a.b', 'c')).not.toBe(firstPageKey('a', 'b.c'));
  });
});
