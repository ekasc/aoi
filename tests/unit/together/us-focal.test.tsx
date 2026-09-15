import { describe, it, expect } from 'vitest';
import {
  findLatestMemory,
  findReadyLetter,
  isQuestionUnanswered,
  selectUsFocal,
} from '@/features/home/us-focal';

function letter(overrides: Record<string, any> = {}) {
  return {
    id: 'l1',
    authorRole: 'partner',
    authorName: 'Alex',
    caption: 'Hi',
    sealedUntil: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    isOpened: false,
    readyToOpen: true,
    openedAt: null,
    ...overrides,
  } as any;
}

function question(overrides: Record<string, any> = {}) {
  return {
    weekKey: '2026-W32',
    questionId: 1,
    question: 'Q?',
    yourAnswer: null,
    yourAnswerUpdatedAt: null,
    partnerAnswered: false,
    partnerAnswer: null,
    partnerName: 'Alex',
    revealed: false,
    ...overrides,
  } as any;
}

function moment(overrides: Record<string, any> = {}) {
  return {
    id: 'm1',
    type: 'note',
    title: 'T',
    body: 'B',
    occurredAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    authorId: 'user_partner',
    authorRole: 'partner',
    authorName: 'Alex',
    ...overrides,
  } as any;
}

describe('us-focal priority', () => {
  it('ready letter beats question and memory', () => {
    const now = new Date();
    const focal = selectUsFocal({
      letters: [letter({ id: 'ready' })],
      question: question(),
      moments: [moment({ id: 'mem' })],
      now,
    });
    expect(focal.kind).toBe('letter');
  });

  it('unopened-but-unready letter does not win', () => {
    const now = new Date();
    expect(
      findReadyLetter(
        [letter({ sealedUntil: new Date(Date.now() + 86400000).toISOString() })],
        now
      )
    ).toBeNull();
  });

  it('opened ready letter does not win', () => {
    expect(findReadyLetter([letter({ isOpened: true })], new Date())).toBeNull();
  });

  it('unanswered question beats memory; answered or revealed does not', () => {
    expect(isQuestionUnanswered(question())).toBe(true);
    expect(isQuestionUnanswered(question({ yourAnswer: 'x' }))).toBe(false);
    expect(isQuestionUnanswered(question({ yourAnswer: '   ' }))).toBe(true);
    expect(isQuestionUnanswered(question({ yourAnswer: null, revealed: true }))).toBe(false);
    expect(isQuestionUnanswered(null)).toBe(false);
  });

  it('prefers newest partner memory, fallback newest shared', () => {
    const partnerOld = moment({ id: 'p-old', authorRole: 'partner', occurredAt: '2026-01-01T00:00:00.000Z' });
    const partnerNew = moment({ id: 'p-new', authorRole: 'partner', occurredAt: '2026-02-01T00:00:00.000Z' });
    const ownNewest = moment({ id: 'own', authorRole: 'you', occurredAt: '2026-06-01T00:00:00.000Z' });
    expect(findLatestMemory([partnerOld, partnerNew, ownNewest])?.id).toBe('p-new');
    expect(
      findLatestMemory([
        moment({ id: 'o1', authorRole: 'you', occurredAt: '2026-01-01T00:00:00.000Z' }),
        moment({ id: 'o2', authorRole: 'you', occurredAt: '2026-04-01T00:00:00.000Z' }),
      ])?.id
    ).toBe('o2');
    expect(findLatestMemory([])).toBeNull();
  });

  it('empty when nothing available', () => {
    const focal = selectUsFocal({
      letters: [letter({ sealedUntil: new Date(Date.now() + 86400000).toISOString() })],
      question: question({ yourAnswer: 'done' }),
      moments: [],
      now: new Date(),
    });
    expect(focal.kind).toBe('empty');
  });
});
