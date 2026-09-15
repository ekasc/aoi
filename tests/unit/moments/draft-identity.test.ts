import { describe, expect, it } from 'vitest';

import { newDraftClientId } from '@/features/moments/draft-identity';

describe('newDraftClientId', () => {
  it('returns an opaque moment-scoped id', () => {
    expect(newDraftClientId()).toMatch(/^moment_[0-9a-f-]{36}$/);
  });

  it('generates a new id per draft, even for identical content', () => {
    expect(newDraftClientId()).not.toBe(newDraftClientId());
  });
});
