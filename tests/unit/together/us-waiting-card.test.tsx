import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { UsWaitingCard } from '@/components/home/us-waiting-card';
import type { UsFocal } from '@/features/home/us-focal';

vi.mock('@/components/themed-text', () => {
  const React = require('react');
  return {
    ThemedText: ({ children, type }: any) =>
      React.createElement('span', { 'data-type': type ?? 'body' }, children),
  };
});

vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children, ...rest }: any) => React.createElement('div', rest, children);
  const Pressable = ({ children, onPress, accessibilityLabel, style }: any) =>
    React.createElement(
      'div',
      {
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
        ...(typeof style === 'function' ? { 'data-pressed': 'fn' } : {}),
      },
      children,
    );
  return {
    View,
    Pressable,
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
  };
});

const letter = {
  id: 'letter-1',
  authorRole: 'partner' as const,
  authorName: 'June',
  caption: 'For a rainy day',
  body: 'SEALED WORDS THAT MUST NOT LEAK',
  sealedUntil: '2026-06-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  isOpened: false,
  readyToOpen: true,
  openedAt: null,
};

const question = {
  weekKey: '2026-W32',
  questionId: 7,
  question: 'What small thing made today good?',
  yourAnswer: null,
  yourAnswerUpdatedAt: null,
  partnerAnswered: false,
  partnerAnswer: null,
  partnerName: null,
  revealed: false,
};

function renderCard(focal: UsFocal, onOpenLetter = vi.fn(), onOpenQuestion = vi.fn()) {
  const utils = render(
    createElement(UsWaitingCard, {
      focal,
      partnerName: 'June',
      onOpenLetter,
      onOpenQuestion,
    }),
  );
  return { ...utils, onOpenLetter, onOpenQuestion };
}

describe('UsWaitingCard', () => {
  it('shows a ready letter as the letter, never its sealed body', () => {
    const { container, onOpenLetter } = renderCard({ kind: 'letter', letter });
    expect(screenText(container)).toContain('For a rainy day');
    expect(screenText(container)).toContain('A letter from June');
    expect(screenText(container)).toContain('Open it');
    // The body is withheld by the API until the letter is opened. The card
    // must not become a way around that.
    expect(screenText(container)).not.toContain('SEALED WORDS');
    fireEvent.click(container.querySelector('[aria-label]')!);
    expect(onOpenLetter).toHaveBeenCalledWith(letter);
  });

  it('falls back to the envelope line when the author left the caption blank', () => {
    const { container } = renderCard({
      kind: 'letter',
      letter: { ...letter, caption: null },
    });
    expect(screenText(container)).toContain('Sealed and waiting');
  });

  it('shows the question itself while it is unanswered', () => {
    const { container, onOpenQuestion } = renderCard({ kind: 'question', question });
    expect(screenText(container)).toContain('What small thing made today good?');
    expect(screenText(container)).toContain('Your answer is waiting');
    fireEvent.click(container.querySelector('[aria-label]')!);
    expect(onOpenQuestion).toHaveBeenCalledTimes(1);
  });

  it('distinguishes your answer from theirs once you have answered', () => {
    const { container } = renderCard({
      kind: 'question',
      question: { ...question, yourAnswer: 'Coffee in bed.' },
    });
    expect(screenText(container)).toContain('You answered. June has not yet.');
  });

  it('says nothing is waiting, and does not push a memory at the reader', () => {
    const { container } = renderCard({
      kind: 'moment',
      moment: {
        id: 'm-1',
        type: 'note',
        title: 'Small wins',
        body: 'Fixed the wobbly shelf.',
        occurredAt: '2026-08-01T10:00:00.000Z',
        targetAt: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        authorId: 'user_partner',
        authorRole: 'partner',
        authorName: 'June',
      },
    });
    expect(screenText(container)).toContain('Nothing waiting');
    expect(screenText(container)).not.toContain('Small wins');
  });

  it('handles an archive with nothing in it at all', () => {
    const { container } = renderCard({ kind: 'empty' });
    expect(screenText(container)).toContain('Nothing waiting');
    expect(screenText(container)).toContain('June is one squeeze away');
  });
});

function screenText(container: HTMLElement): string {
  return container.textContent ?? '';
}
