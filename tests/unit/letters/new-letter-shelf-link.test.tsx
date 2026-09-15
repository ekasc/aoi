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
  useLetters: () => ({ letters: [], sealLetter: sealLetterSpy, isSealing: false }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ serverPlus: null, refreshServerPlus }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { partnerName: 'Alex', relationshipStartDate: null } }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: () => null,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

const sealLetterSpy = vi.fn();
const refreshServerPlus = vi.fn(async () => {});

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  sealLetterSpy.mockReset();
  sealLetterSpy.mockResolvedValue({ id: 'letter-1' });
  refreshServerPlus.mockClear();
});

async function renderNewLetter() {
  const { default: NewLetterScreen } = await import('@/app/(app)/letter/new');
  return render(createElement(NewLetterScreen));
}

describe('new letter confirmation links to the shelf', () => {
  it('offers Back to Letters after sealing and navigates once', async () => {
    await renderNewLetter();
    fireEvent.change(screen.getByPlaceholderText(/Write it as if/), {
      target: { value: 'Dear future us' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Seal it'));
    });

    expect(screen.getByText('Sealed.')).toBeTruthy();
    expect(screen.getByText('Back to Letters')).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Letters'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/letters');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
  });
});
