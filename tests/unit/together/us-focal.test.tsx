import { describe, it, expect } from 'vitest';

import { findReadyLetter } from '@/features/home/us-focal';
import type { Letter } from '@/features/letters/types';

function letter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'l1',
    caption: 'For later',
    createdAt: '2026-01-01T00:00:00.000Z',
    authorRole: 'you',
    authorName: 'You',
    sealedUntil: '2026-01-01T00:00:00.000Z',
    isOpened: false,
    readyToOpen: false,
    openedAt: null,
    ...overrides,
  } as Letter;
}

describe('findReadyLetter', () => {
  const past = new Date('2026-06-01T00:00:00.000Z');
  const future = new Date('2027-01-01T00:00:00.000Z');

  it('returns the first unopened letter whose seal has broken', () => {
    const found = findReadyLetter([letter({ sealedUntil: '2026-01-01T00:00:00.000Z' })], past);
    expect(found?.id).toBe('l1');
  });

  it('honours shelf order and never re-sorts', () => {
    const first = letter({ id: 'newest', sealedUntil: '2026-01-01T00:00:00.000Z' });
    const second = letter({ id: 'next', sealedUntil: '2026-01-02T00:00:00.000Z' });
    expect(findReadyLetter([first, second], past)?.id).toBe('newest');
  });

  it('never returns a letter that is not yet due', () => {
    expect(findReadyLetter([letter({ sealedUntil: '2027-01-01T00:00:00.000Z' })], past)).toBeNull();
  });

  it('never returns an already-opened letter, however old', () => {
    const opened = letter({
      sealedUntil: '2020-01-01T00:00:00.000Z',
      isOpened: true,
    });
    expect(findReadyLetter([opened], past)).toBeNull();
  });

  it('is null for an empty shelf rather than throwing', () => {
    expect(findReadyLetter([], future)).toBeNull();
  });
});
