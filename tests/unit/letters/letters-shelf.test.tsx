import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        if (entry && typeof entry === 'object') Object.assign(merged, entry);
      }
      return merged;
    }
    return style;
  }

  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }

  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withAriaProps(props) },
      children
    );
  }

  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };

  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement(
      'span',
      { style: flattenStyle(style), ...withAriaProps(rest) },
      children
    );
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content =
      typeof children === 'function'
        ? (children as (s: { pressed: boolean }) => unknown)({ pressed: false })
        : children;
    return createDiv(content, resolved, rest);
  };

  return {
    StyleSheet: { create: (s: Record<string, unknown>) => s, hairlineWidth: 1 },
    View,
    Text,
    Pressable,
    ScrollView: View,
    ActivityIndicator: () => createElement('div', { 'aria-label': 'Loading' }),
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) =>
    createElement('span', {}, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement('button', { onClick: onPress }, label),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

vi.mock('@/components/letters/letter-card', () => ({
  LetterCard: ({
    letter,
    onPress,
  }: {
    letter: { id: string; caption: string | null };
    onPress?: (l: unknown) => void;
  }) =>
    createElement(
      'div',
      {
        'data-testid': `letter-${letter.id}`,
        onClick: onPress ? () => onPress(letter) : undefined,
      },
      letter.caption ?? 'An unopened letter'
    ),
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => mockLettersState,
}));

let mockLettersState: {
  letters: Record<string, any>[];
  isLoading: boolean;
  error: string | null;
  openLetter: (...args: any[]) => Promise<any>;
  reload: () => Promise<void>;
};

const openLetterSpy = vi.fn();
const reloadSpy = vi.fn(async () => {});

const DAY_MS = 24 * 60 * 60 * 1000;

function sealedLetter(overrides: Record<string, any> = {}) {
  return {
    id: 'letter-sealed-1',
    authorRole: 'partner',
    authorName: 'Them',
    caption: 'For a quiet day',
    sealedUntil: new Date(Date.now() + 10 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    isOpened: false,
    readyToOpen: false,
    openedAt: null,
    ...overrides,
  };
}

function readyLetter(overrides: Record<string, any> = {}) {
  return sealedLetter({
    id: 'letter-ready-1',
    sealedUntil: new Date(Date.now() - 60_000).toISOString(),
    readyToOpen: true,
    ...overrides,
  });
}

function openedLetter(overrides: Record<string, any> = {}) {
  return sealedLetter({
    id: 'letter-opened-1',
    isOpened: true,
    readyToOpen: true,
    body: 'These words were opened already.',
    openedAt: new Date(Date.now() - DAY_MS).toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  pushSpy.mockClear();
  openLetterSpy.mockReset();
  reloadSpy.mockClear();
  mockLettersState = {
    letters: [],
    isLoading: false,
    error: null,
    openLetter: openLetterSpy,
    reload: reloadSpy,
  };
  vi.useRealTimers();
});

async function renderShelf() {
  const { default: LettersScreen } = await import('@/app/(app)/letters');
  return render(createElement(LettersScreen));
}

describe('letters shelf opens through the server into the reader', () => {
  it('opens a ready letter via openLetter then navigates to the reader', async () => {
    const letter = readyLetter();
    mockLettersState.letters = [letter];
    openLetterSpy.mockResolvedValue({ ...letter, isOpened: true, id: letter.id });
    const { unmount } = await renderShelf();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`letter-${letter.id}`));
    });

    expect(openLetterSpy).toHaveBeenCalledTimes(1);
    expect(openLetterSpy).toHaveBeenCalledWith(letter.id);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/letter/[id]',
      params: { id: letter.id },
    });
    unmount();
  });

  it('navigates directly for an already-opened letter without calling open', async () => {
    const letter = openedLetter();
    mockLettersState.letters = [letter];
    const { unmount } = await renderShelf();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`letter-${letter.id}`));
    });

    expect(openLetterSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/letter/[id]',
      params: { id: letter.id },
    });
    unmount();
  });

  it('shows a quiet hint for a sealed letter without opening or navigating', async () => {
    const letter = sealedLetter();
    mockLettersState.letters = [letter];
    const { unmount } = await renderShelf();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`letter-${letter.id}`));
    });

    expect(openLetterSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Not yet time/)).toBeTruthy();
    unmount();
  });

  it('stays on the shelf with a hint when the server open fails', async () => {
    const letter = readyLetter();
    mockLettersState.letters = [letter];
    openLetterSpy.mockRejectedValueOnce(new Error('Network request failed'));
    const { unmount } = await renderShelf();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`letter-${letter.id}`));
    });

    expect(openLetterSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't be opened/)).toBeTruthy();
    unmount();
  });

  it('never renders sealed bodies on the shelf', async () => {
    const secret = 'shelf-secret-words-never-shown';
    const letter = sealedLetter({ body: secret });
    mockLettersState.letters = [letter];
    const { container, unmount } = await renderShelf();

    expect(container.textContent).not.toContain(secret);
    expect(screen.queryByText(secret)).toBeNull();
    unmount();
  });
});
