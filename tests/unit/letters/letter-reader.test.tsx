import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: vi.fn() }),
  useLocalSearchParams: () => mockParams,
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

  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement('div', { style: flattenStyle(style), ...rest }, children);
  };

  return {
    StyleSheet: { create: (s: Record<string, unknown>) => s },
    View,
    ScrollView: View,
    ActivityIndicator: (props: Record<string, unknown>) =>
      createElement('div', { 'aria-label': 'Loading', ...props }),
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  (chain as Record<string, unknown>).springify = () => chain;
  (chain as Record<string, unknown>).damping = () => chain;
  (chain as Record<string, unknown>).stiffness = () => chain;
  (chain as Record<string, unknown>).withInitialValues = () => chain;
  return {
    default: {
      View: ({ children }: { children?: unknown }) =>
        createElement('div', {}, children),
    },
    FadeIn: chain,
    ZoomIn: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

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

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => mockLettersState,
}));

let mockParams: Record<string, unknown> = { id: 'letter-1' };
let mockLettersState: {
  letters: Record<string, any>[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const reloadSpy = vi.fn(async () => {});
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET_BODY = 'reader-secret-words-only-when-opened';

function baseLetter(overrides: Record<string, any> = {}) {
  return {
    id: 'letter-1',
    authorRole: 'partner',
    authorName: 'Them',
    caption: 'For a quiet day',
    sealedUntil: new Date(Date.now() - DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    isOpened: false,
    readyToOpen: true,
    openedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  reloadSpy.mockClear();
  mockParams = { id: 'letter-1' };
  mockLettersState = { letters: [], isLoading: false, error: null, reload: reloadSpy };
});

async function renderReader() {
  const { default: LetterReaderScreen } = await import('@/app/(app)/letter/[id]');
  return render(createElement(LetterReaderScreen));
}

describe('letter reader', () => {
  it('shows loading without the words', async () => {
    mockLettersState.isLoading = true;
    const { container, unmount } = await renderReader();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(container.textContent).not.toContain(SECRET_BODY);
    unmount();
  });

  it('shows not-found with back to shelf', async () => {
    mockLettersState.letters = [];
    const { unmount } = await renderReader();
    expect(screen.getByText('Letter not found')).toBeTruthy();
    fireEvent.click(screen.getByText('Back to Letters'));
    expect(backSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('shows the load error with retry and back to shelf', async () => {
    mockLettersState.letters = [];
    mockLettersState.error = 'Your letters could not be loaded right now.';
    const { unmount } = await renderReader();
    expect(screen.getByText('Your letters could not be loaded right now.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Back to Letters'));
    expect(backSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('never renders the body for a sealed letter', async () => {
    mockLettersState.letters = [baseLetter({ body: SECRET_BODY })];
    const { container, unmount } = await renderReader();
    expect(screen.getByText('For a quiet day')).toBeTruthy();
    expect(screen.queryByText(SECRET_BODY)).toBeNull();
    expect(container.textContent).not.toContain(SECRET_BODY);
    fireEvent.click(screen.getByText('Back to Letters'));
    expect(backSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('shows the full body in the reading surface once opened', async () => {
    mockLettersState.letters = [
      baseLetter({
        isOpened: true,
        body: SECRET_BODY,
        openedAt: new Date(Date.now() - DAY_MS).toISOString(),
      }),
    ];
    const { unmount } = await renderReader();
    expect(screen.getByText(SECRET_BODY)).toBeTruthy();
    expect(screen.getByText(/Them/)).toBeTruthy();
    expect(screen.getByText('Back to Letters')).toBeTruthy();
    unmount();
  });
});
