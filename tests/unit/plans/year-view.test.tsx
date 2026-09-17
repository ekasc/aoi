import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const { backSpy, setSelectedDateSpy, setVisibleMonthSpy } = vi.hoisted(() => ({
  backSpy: vi.fn(),
  setSelectedDateSpy: vi.fn(),
  setVisibleMonthSpy: vi.fn(),
}));

// Same RN boundary as the other Plans tests: resolve press-state styles, map
// accessibilityLabel to aria-label and onPress to onClick.
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

  return {
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    StyleSheet: {
      absoluteFillObject: {},
      create: (styles: Record<string, unknown>) => styles,
      flatten: flattenStyle,
      hairlineWidth: 1,
    },
    View: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never),
    Text: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('span', { ...withAria(rest), style: flattenStyle(style) }, children as never),
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
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 3, width: 390 }),
  };
});

vi.mock('moti', () => ({
  AnimatePresence: ({ children }: { children?: unknown }) => children,
  MotiView: ({ children, ...rest }: Record<string, unknown>) => {
    const { animate, exit, from, transition, ...props } = rest;
    const style = (props as { style?: unknown }).style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return createElement('div', { ...props, style: flat }, children as never);
  },
}));

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
  useRouter: () => ({ back: backSpy, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: new Date(2026, 8, 16, 12, 0, 0),
    setSelectedDate: setSelectedDateSpy,
    setVisibleMonth: setVisibleMonthSpy,
    visibleMonth: new Date(2026, 8, 1),
  }),
}));

beforeEach(() => {
  backSpy.mockClear();
  setSelectedDateSpy.mockClear();
  setVisibleMonthSpy.mockClear();
});

describe('Calendar year view', () => {
  it('shows a year of months at a glance and opens the one you tap', async () => {
    const { default: YearScreen } = await import('@/app/(app)/calendar/year');
    render(<YearScreen />);

    // Twelve months for each year in the window, not one month at a time.
    const months = screen.getAllByLabelText(/^Open [A-Z][a-z]+ \d{4}$/);
    expect(months.length).toBeGreaterThanOrEqual(12);
    expect(months.length % 12).toBe(0);

    const thisYear = new Date().getFullYear();
    const septemberThisYear = screen.getByLabelText(`Open September ${thisYear}`);
    fireEvent.click(septemberThisYear);

    expect(setVisibleMonthSpy).toHaveBeenCalledTimes(1);
    expect(setSelectedDateSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).toHaveBeenCalledTimes(1);

    // The month it hands back is the first of that month, not the tapped cell.
    const handedBack = setSelectedDateSpy.mock.calls[0][0] as Date;
    expect(handedBack.getDate()).toBe(1);
    expect(handedBack.getMonth()).toBe(8);
    expect(handedBack.getFullYear()).toBe(thisYear);
  });
});
