import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const { pushSpy, eventsInRangeSpy } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  eventsInRangeSpy: vi.fn(),
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

  function withAria(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }

  const View = ({ children, style, ...rest }: Record<string, unknown>) =>
    createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never);
  const Text = ({ children, style, ...rest }: Record<string, unknown>) =>
    createElement('span', { ...withAria(rest), style: flattenStyle(style) }, children as never);

  return {
    ActivityIndicator: () => createElement('div', {}, null),
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    StyleSheet: {
      absoluteFill: {},
      absoluteFillObject: {},
      create: (styles: Record<string, unknown>) => styles,
      flatten: flattenStyle,
      hairlineWidth: 1,
    },
    View,
    Text,
    Pressable: ({ children, style, ...rest }: Record<string, unknown>) => {
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      return createElement(
        'div',
        { ...withAria(rest), style: flattenStyle(resolved) },
        children as never,
      );
    },
    ScrollView: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never),
    TextInput: ({ onChangeText, style, value, ...rest }: Record<string, unknown>) =>
      createElement('input', {
        ...withAria(rest),
        onChange: (event: { target: { value: string } }) => {
          if (typeof onChangeText === 'function') {
            onChangeText(event.target.value);
          }
        },
        style: flattenStyle(style),
        value: (value as string) ?? '',
      }),
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 3, width: 390 }),
  };
});

vi.mock('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: ({ children }: { children?: unknown }) => createElement('div', {}, children),
  },
  FadeIn: {},
  FadeInDown: {},
  ReduceMotion: { System: 'system' },
  useReducedMotion: () => false,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: pushSpy, replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({ eventsInRange: eventsInRangeSpy }),
}));

const careerFair = {
  actor: 'you',
  actorName: 'Maya',
  allDay: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-16T17:00:00.000Z',
  id: 'fair',
  isOwn: true,
  label: { preset: 'Work' },
  startsAt: '2026-09-16T16:00:00.000Z',
  title: 'Career fair',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  pushSpy.mockClear();
  eventsInRangeSpy.mockReset();
  eventsInRangeSpy.mockResolvedValue([careerFair]);
});

describe('Calendar search screen', () => {
  it('finds an event by name and opens it', async () => {
    const { default: SearchScreen } = await import('@/app/(app)/calendar/search');
    render(<SearchScreen />);

    const field = screen.getByLabelText('Search events');
    fireEvent.change(field, { target: { value: 'career' } });

    expect(await screen.findByText('Career fair')).toBeTruthy();
    // The count is announced, not just drawn.
    await waitFor(() => expect(screen.getByText('1 event')).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/^Open Career fair/));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/calendar/edit/fair');
  });

  it('says so when nothing matches, and loads nothing until asked', async () => {
    const { default: SearchScreen } = await import('@/app/(app)/calendar/search');
    render(<SearchScreen />);

    // One read for the window, not one per keystroke.
    await waitFor(() => expect(eventsInRangeSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Type to search titles, labels or a name')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'nothing like this' },
    });
    expect(await screen.findByText('Nothing matches "nothing like this".')).toBeTruthy();
    expect(eventsInRangeSpy).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the read fails, instead of an empty screen', async () => {
    eventsInRangeSpy.mockRejectedValueOnce(new Error('offline'));
    const { default: SearchScreen } = await import('@/app/(app)/calendar/search');
    render(<SearchScreen />);

    expect(await screen.findByText('Could not load your events.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Try again'));
    await waitFor(() => expect(eventsInRangeSpy).toHaveBeenCalledTimes(2));
  });
});
