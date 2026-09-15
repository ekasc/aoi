import { vi, describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Letter } from '@aoi/shared';

import { LetterCard } from '@/components/letters/letter-card';

// The global react-native mock renders Pressable children verbatim, which
// breaks the card's pressed-state render prop — re-mock with one that calls
// the function children.
vi.mock('react-native', () => {
  const React = require('react');

  const flatten = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.filter(Boolean));
    }
    return (style as Record<string, unknown>) ?? {};
  };

  const View = ({ children, style, testID, ...rest }: Record<string, unknown>) =>
    React.createElement(
      'div',
      {
        style: flatten(style),
        ...(typeof testID === 'string' ? { 'data-testid': testID } : {}),
        ...rest,
      },
      children as never
    );

  const Pressable = ({ children, style, onPress, ...rest }: Record<string, unknown>) => {
    const content =
      typeof children === 'function'
        ? (children as (state: { pressed: boolean }) => unknown)({ pressed: false })
        : children;
    return React.createElement(
      'div',
      { style: flatten(style), onClick: onPress, ...rest },
      content as never
    );
  };

  return {
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    View,
    Pressable,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  return {
    default: {
      View: ({
        children,
        testID,
        style,
      }: {
        children?: unknown;
        testID?: string;
        style?: unknown;
      }) => {
        const React = require('react');
        const flat = Array.isArray(style)
          ? Object.assign({}, ...(style as unknown[]).filter(Boolean))
          : style;
        return React.createElement(
          'div',
          {
            ...(typeof testID === 'string' ? { 'data-testid': testID } : {}),
            style: flat,
          },
          children
        );
      },
    },
    FadeIn: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style }: { children?: unknown; style?: unknown }) => {
    const React = require('react');
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return React.createElement('span', { style: flat }, children);
  },
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({
    children,
    style,
    variant,
  }: {
    children?: unknown;
    style?: unknown;
    variant?: string;
  }) => {
    const React = require('react');
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return React.createElement(
      'div',
      { style: flat, 'data-testid': 'surface', 'data-variant': variant ?? 'card' },
      children
    );
  },
}));

vi.mock('@/hooks/use-theme-color', () => ({
  // Distinct tokens so authorship (the dot) and readiness (warning) stay observable.
  useThemeColor: (_overrides: unknown, name: string) => {
    if (name === 'accent') return '#aa1111';
    if (name === 'partnerAccent') return '#11aa11';
    if (name === 'warning') return '#c19a11';
    return '#000000';
  },
}));

const SECRET_BODY = 'These words are sealed away until the day arrives.';
const DAY_MS = 24 * 60 * 60 * 1000;

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-1',
    authorRole: 'you',
    authorName: 'You',
    caption: 'For a quiet day',
    sealedUntil: new Date(Date.now() + 10 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    isOpened: false,
    readyToOpen: false,
    openedAt: null,
    ...overrides,
  };
}

/** The author dot is the only authorship marker — find it by its color. */
function findDot(container: HTMLElement, color: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll('div'));
  return (
    candidates.find((element) => element.style.backgroundColor === color) ?? null
  );
}

describe('LetterCard', () => {
  describe('sealed letters', () => {
    it('shows the caption, never the words', () => {
      const { container } = render(<LetterCard letter={makeLetter()} />);
      expect(screen.getByText('For a quiet day')).toBeTruthy();
      expect(screen.getByText(/Sealed by You/)).toBeTruthy();
      // The body is not even present on a sealed letter from the API — but
      // the card must not leak it if it ever were.
      expect(screen.queryByText(SECRET_BODY)).toBeNull();
      expect(container.textContent).not.toContain('sealed away');
    });

    it('does not render the words even if a body is somehow present', () => {
      const { container } = render(
        <LetterCard letter={makeLetter({ body: SECRET_BODY })} />
      );
      expect(container.textContent).not.toContain(SECRET_BODY);
    });

    it('falls back to "An unopened letter" without a caption', () => {
      render(<LetterCard letter={makeLetter({ caption: null })} />);
      expect(screen.getByText('An unopened letter')).toBeTruthy();
    });

    it('shows the waiting label before the seal day', () => {
      render(<LetterCard letter={makeLetter()} />);
      expect(screen.getByText(/Opens in 10 days/)).toBeTruthy();
      expect(screen.queryByText('Ready to open')).toBeNull();
    });

    it('glows with "Ready to open" once due', () => {
      const due = new Date(Date.now() - 60_000);
      render(
        <LetterCard
          letter={makeLetter({ sealedUntil: due.toISOString(), readyToOpen: true })}
        />
      );
      expect(screen.getByText(/Ready to open/)).toBeTruthy();
    });

    it('marks authorship with an accent dot for "you"', () => {
      const { container } = render(<LetterCard letter={makeLetter()} />);
      expect(findDot(container, '#aa1111')).not.toBeNull();
      expect(findDot(container, '#11aa11')).toBeNull();
    });

    it('marks the partner with the partnerAccent dot', () => {
      const { container } = render(
        <LetterCard
          letter={makeLetter({ authorRole: 'partner', authorName: 'Them' })}
        />
      );
      expect(screen.getByText(/Sealed by Them/)).toBeTruthy();
      expect(findDot(container, '#11aa11')).not.toBeNull();
      expect(findDot(container, '#aa1111')).toBeNull();
    });

    it('invokes the press handler with the letter', () => {
      const onPress = vi.fn();
      const letter = makeLetter();
      const { container } = render(
        <LetterCard letter={letter} onPress={onPress} />
      );
      fireEvent.click(container.firstChild as Element);
      expect(onPress).toHaveBeenCalledWith(letter);
    });
  });

  describe('opened letters', () => {
    const openedAt = new Date(Date.now() - 2 * DAY_MS);

    it('keeps the words off the shelf once opened', () => {
      const { container } = render(
        <LetterCard
          letter={makeLetter({
            isOpened: true,
            readyToOpen: true,
            body: SECRET_BODY,
            openedAt: openedAt.toISOString(),
          })}
        />
      );
      // Quiet metadata only — the body lives in the dedicated reader.
      expect(screen.getByText('For a quiet day')).toBeTruthy();
      expect(screen.getByText(/Opened/)).toBeTruthy();
      expect(screen.queryByText(SECRET_BODY)).toBeNull();
      expect(container.textContent).not.toContain(SECRET_BODY);
    });

    it('shows the author and the day it was opened', () => {
      render(
        <LetterCard
          letter={makeLetter({
            isOpened: true,
            readyToOpen: true,
            body: SECRET_BODY,
            openedAt: openedAt.toISOString(),
            authorRole: 'partner',
            authorName: 'Them',
          })}
        />
      );
      expect(screen.getByText(/Them · Opened/)).toBeTruthy();
    });

    it('falls back to "An opened letter" without a caption', () => {
      render(
        <LetterCard
          letter={makeLetter({
            isOpened: true,
            readyToOpen: true,
            body: SECRET_BODY,
            openedAt: openedAt.toISOString(),
            caption: null,
          })}
        />
      );
      expect(screen.getByText('An opened letter')).toBeTruthy();
    });

    it('is pressable once opened to revisit in the reader', () => {
      const onPress = vi.fn();
      const letter = makeLetter({
        isOpened: true,
        readyToOpen: true,
        body: SECRET_BODY,
        openedAt: openedAt.toISOString(),
      });
      const { container } = render(
        <LetterCard letter={letter} onPress={onPress} />
      );
      fireEvent.click(container.firstChild as Element);
      expect(onPress).toHaveBeenCalledWith(letter);
    });
  });

  describe('layered envelope', () => {
    it('sealed waiting shows the flap without a ready edge or open slot', () => {
      render(<LetterCard letter={makeLetter()} />);
      expect(screen.getByTestId('letter-flap')).toBeTruthy();
      expect(screen.queryByTestId('letter-ready-edge')).toBeNull();
      expect(screen.queryByTestId('letter-open-slot')).toBeNull();
    });

    it('sealed ready layers the flap with a warm ready edge', () => {
      const due = new Date(Date.now() - 60_000);
      render(
        <LetterCard
          letter={makeLetter({ sealedUntil: due.toISOString(), readyToOpen: true })}
        />
      );
      expect(screen.getByTestId('letter-flap')).toBeTruthy();
      expect(screen.getByTestId('letter-ready-edge')).toBeTruthy();
      expect(screen.queryByTestId('letter-open-slot')).toBeNull();
      expect(screen.getByText(/Ready to open/)).toBeTruthy();
    });

    it('owns readiness with warning, never accent alone', () => {
      const due = new Date(Date.now() - 60_000);
      const { container } = render(
        <LetterCard
          letter={makeLetter({ sealedUntil: due.toISOString(), readyToOpen: true })}
        />
      );
      // Ready edge pairs its gold with the Ready words.
      const edge = screen.getByTestId('letter-ready-edge') as HTMLElement;
      expect(edge.style.backgroundColor).toBe('#c19a11');
      expect(screen.getByText(/Ready to open/).style.color).toBe('#c19a11');
      // The sealed border joins the same warm job.
      const surfaces = screen.getAllByTestId('surface');
      expect(surfaces[0].style.borderColor).toBe('#c19a11');
      // No accent leaks into the ready treatment.
      expect(container.textContent).toBeTruthy();
      expect(edge.style.backgroundColor).not.toBe('#aa1111');
    });

    it('keeps sealed-waiting and opened states off warning', () => {
      render(<LetterCard letter={makeLetter()} />);
      expect(screen.getByText(/Opens in 10 days/).style.color).toBe('#000000');
      expect(screen.getByTestId('surface').style.borderColor).toBe('#000000');
    });

    it('opened shows the open slot instead of the sealed flap', () => {
      const openedAt = new Date(Date.now() - 2 * DAY_MS).toISOString();
      render(
        <LetterCard
          letter={makeLetter({
            isOpened: true,
            readyToOpen: true,
            openedAt,
          })}
        />
      );
      expect(screen.getByTestId('letter-open-slot')).toBeTruthy();
      expect(screen.queryByTestId('letter-flap')).toBeNull();
      expect(screen.queryByTestId('letter-ready-edge')).toBeNull();
      expect(screen.getByText(/Opened/)).toBeTruthy();
    });

    it('uses a raised paper surface for tactile depth', () => {
      render(<LetterCard letter={makeLetter()} />);
      expect(screen.getByTestId('surface').getAttribute('data-variant')).toBe(
        'raised'
      );
    });

    it('keeps a 44pt press target on the envelope', () => {
      const { container } = render(
        <LetterCard letter={makeLetter()} onPress={() => {}} />
      );
      const target = container.firstChild as HTMLElement;
      expect(['44', '44px']).toContain(target.style.minHeight);
    });
  });
});
