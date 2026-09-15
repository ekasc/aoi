import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

// Resolve press-state styles as unpressed so the real screen renders.
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
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
    return createDiv(children, resolved, rest);
  };

  const TextInput = (props: Record<string, any>) => {
    const { style, value, onChangeText, placeholder, ...rest } = props;
    return createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      ...withAriaProps(rest),
    });
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
    },
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView: View,
    KeyboardAvoidingView: View,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  (chain as Record<string, unknown>).springify = () => chain;
  (chain as Record<string, unknown>).withInitialValues = () => chain;
  return {
    default: {
      View: ({ children }: { children?: unknown }) =>
        createElement('div', {}, children),
    },
    FadeIn: chain,
    FadeInDown: chain,
    ZoomIn: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({ letters: mockLetters, sealLetter: sealLetterSpy, isSealing: false }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ serverPlus: mockServerPlus, refreshServerPlus }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { relationshipStartDate: null } }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: () => null,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

let mockLetters: Record<string, any>[] = [];
let mockServerPlus: Record<string, any> | null = null;
const sealLetterSpy = vi.fn();
const refreshServerPlus = vi.fn(async () => {});

function freeServerPlus(activeFutureLetters: number) {
  return {
    isPlus: false,
    status: 'inactive',
    expiresAt: null,
    mediaUsedBytes: 0,
    mediaLimitBytes: 250 * 1024 * 1024,
    activeFutureLetters,
    futureLetterLimit: 1,
  };
}

function plusServerPlus() {
  return {
    isPlus: true,
    status: 'active',
    expiresAt: null,
    mediaUsedBytes: 0,
    mediaLimitBytes: 5 * 1024 * 1024 * 1024,
    activeFutureLetters: 2,
    futureLetterLimit: null,
  };
}

function makeLetter(id: string) {
  return { id, isOpened: false };
}

function limitError() {
  return Object.assign(new Error('This space already holds its future letter'), {
    code: 'LIMIT_EXCEEDED',
    details: { kind: 'future_letters', usedCount: 1, limitCount: 1 },
  });
}

beforeEach(() => {
  mockLetters = [];
  mockServerPlus = freeServerPlus(0);
  pushSpy.mockClear();
  sealLetterSpy.mockReset();
  sealLetterSpy.mockResolvedValue({ id: 'letter-1' });
  refreshServerPlus.mockClear();
});

async function renderNewLetter() {
  const { default: NewLetterScreen } = await import('@/app/(app)/letter/new');
  return render(<NewLetterScreen />);
}

function writeDraft() {
  fireEvent.change(screen.getByPlaceholderText(/Write it as if/), {
    target: { value: 'Dear future us' },
  });
}

describe('letter creation against server allowance', () => {
  it('Free first active future letter seals', async () => {
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(sealLetterSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalledWith('/(app)/paywall');
  });

  it('known Free allowance routes the second letter to upgrade with draft intact', async () => {
    mockServerPlus = freeServerPlus(1);
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(sealLetterSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith('/(app)/paywall');
    // Draft preserved for the return trip.
    expect(screen.getByDisplayValue('Dear future us')).toBeTruthy();
  });

  it('server rejection surfaces the upgrade panel with draft intact', async () => {
    // serverPlus unknown locally, but the server enforces on seal.
    mockServerPlus = null;
    sealLetterSpy.mockRejectedValueOnce(limitError());
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(sealLetterSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Your Space holds its future letter.')).toBeTruthy();
    expect(screen.getByDisplayValue('Dear future us')).toBeTruthy();
    expect(refreshServerPlus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Unlock Plus'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/paywall');
  });

  it('Plus never blocks sealing', async () => {
    mockServerPlus = plusServerPlus();
    mockLetters = [makeLetter('l1'), makeLetter('l2')];
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(sealLetterSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Your Space holds its future letter.')).toBeNull();
  });
});
