import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: vi.fn() }),
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
    if (typeof props.accessibilityState === 'object' && props.accessibilityState !== null) {
      next['aria-selected'] = String(
        (props.accessibilityState as { selected?: boolean }).selected
      );
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
  useLetters: () => ({ letters: [], sealLetter: sealLetterSpy, isSealing: false }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ serverPlus: null, refreshServerPlus }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: (props: Record<string, any>) => {
    capturedDateField = props;
    return null;
  },
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

let mockSpace: Record<string, any> | null = null;
let capturedDateField: Record<string, any> | null = null;
const sealLetterSpy = vi.fn();
const refreshServerPlus = vi.fn(async () => {});

beforeEach(() => {
  mockSpace = { partnerName: 'Alex', relationshipStartDate: '2023-06-15' };
  capturedDateField = null;
  pushSpy.mockClear();
  backSpy.mockClear();
  sealLetterSpy.mockReset();
  sealLetterSpy.mockResolvedValue({ id: 'letter-1' });
  refreshServerPlus.mockClear();
});

async function renderNewLetter() {
  const { default: NewLetterScreen } = await import('@/app/(app)/letter/new');
  return render(<NewLetterScreen />);
}

function writeDraft(value = 'Dear future us') {
  fireEvent.change(screen.getByPlaceholderText(/Write it as if/), {
    target: { value },
  });
}

describe('letter seal guard', () => {
  it('ignores a same-tick duplicate seal', async () => {
    let resolveSeal!: (value: unknown) => void;
    sealLetterSpy.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSeal = resolve; })
    );
    await renderNewLetter();
    writeDraft();

    fireEvent.click(screen.getByText('Seal it'));
    fireEvent.click(screen.getByText('Seal it'));

    await act(async () => {
      resolveSeal({ id: 'letter-1' });
    });

    expect(sealLetterSpy).toHaveBeenCalledTimes(1);
  });

  it('offers Done immediately after sealing instead of forcing the wait', async () => {
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(screen.getByText('Sealed.')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft when sealing fails generically', async () => {
    sealLetterSpy.mockRejectedValueOnce(new Error('Network request failed'));
    await renderNewLetter();
    writeDraft();

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(screen.getByDisplayValue('Dear future us')).toBeTruthy();
    expect(screen.getByText(/Network request failed/)).toBeTruthy();
  });
});

describe('letter seal date choices', () => {
  it('uses the existing preset choices with the anniversary when known', async () => {
    await renderNewLetter();

    expect(screen.getByLabelText('Seal date: In a month')).toBeTruthy();
    expect(screen.getByLabelText('Seal date: In a year')).toBeTruthy();
    expect(screen.getByLabelText('Seal date: Our next anniversary')).toBeTruthy();
    expect(screen.getByLabelText('Seal date: Pick a day')).toBeTruthy();
  });

  it('hides the anniversary when no start date is known', async () => {
    mockSpace = { partnerName: 'Alex', relationshipStartDate: null };
    const { unmount } = await renderNewLetter();

    expect(screen.queryByLabelText('Seal date: Our next anniversary')).toBeNull();
    unmount();
  });

  it('shows the formatted actual date under the choices', async () => {
    await renderNewLetter();

    // e.g. "Opens September 3, 2026." — a real date, never a speculative label.
    expect(screen.getByText(/^Opens [A-Z][a-z]+ \d{1,2}, \d{4}\./)).toBeTruthy();
  });

  it('keeps the custom day minimum and horizon', async () => {
    await renderNewLetter();
    fireEvent.click(screen.getByLabelText('Seal date: Pick a day'));

    expect(capturedDateField).not.toBeNull();
    const minimum = (capturedDateField?.minimumDate as Date).getTime();
    const maximum = (capturedDateField?.maximumDate as Date).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    // Minimum is at least tomorrow; horizon preserves the existing bound.
    expect(minimum).toBeGreaterThan(Date.now());
    expect(maximum - minimum).toBeGreaterThan(30 * dayMs);
    expect(maximum - minimum).toBeLessThan(18262 * dayMs + dayMs);
  });
});

describe('sealed finish navigates once', () => {
  it('Done plus the auto-timer backs only once', async () => {
    vi.useFakeTimers();
    try {
      await renderNewLetter();
      writeDraft();

      await act(async () => {
        fireEvent.click(screen.getByText('Seal it'));
      });
      expect(screen.getByText('Sealed.')).toBeTruthy();

      fireEvent.click(screen.getByText('Done'));
      expect(backSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(backSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-timer alone backs once and ignores a late Done', async () => {
    vi.useFakeTimers();
    try {
      await renderNewLetter();
      writeDraft();

      await act(async () => {
        fireEvent.click(screen.getByText('Seal it'));
      });
      expect(screen.getByText('Sealed.')).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(backSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('Done'));
      expect(backSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('letter recipient', () => {
  it('addresses the real partner name when known', async () => {
    await renderNewLetter();
    expect(screen.getByText('For Alex')).toBeTruthy();
  });

  it('falls back gracefully when no partner name is known', async () => {
    mockSpace = { partnerName: null, relationshipStartDate: null };
    const { unmount } = await renderNewLetter();
    expect(screen.getByText('For the two of you')).toBeTruthy();
    unmount();
  });
});
