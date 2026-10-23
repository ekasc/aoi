import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect } from 'react';

// The sized sheet and the native header chrome are iOS: this file runs where
// the app ships, and calendar-new-event-seed.test.tsx keeps covering the
// footer those platforms still use.
const previousExpoOs = process.env.EXPO_OS;
process.env.EXPO_OS = 'ios';

const addEventSpy = vi.fn(async () => {});
const backSpy = vi.fn();
const preventLeaveSpy = vi.fn();

// What the platform reports for the form's laid-out height.
const MEASURED_FORM_HEIGHT = 402;

const formProps: { current: Record<string, any> | null } = { current: null };

vi.mock('expo-router', () => {
  const ToolbarButton = ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  );
  const Toolbar = Object.assign(
    ({ children }: any) => <div>{children}</div>,
    { Button: ToolbarButton }
  );

  return {
    Stack: { Screen: () => null, Toolbar },
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ back: backSpy, push: vi.fn() }),
  };
});

vi.mock('@/hooks/use-prevent-leave', () => ({
  usePreventLeave: (...args: unknown[]) => preventLeaveSpy(...args),
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({ addEvent: addEventSpy }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: ({ label }: any) => <span>{label}</span>,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

// Same RN boundary as the other screen tests, plus the one thing this file is
// about: the scroll view reports the height the sheet has to take.
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): any {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  function withDomProps(props: Record<string, any>): Record<string, any> {
    const next: Record<string, any> = { ...props };
    if (typeof props.testID === 'string') next['data-testid'] = props.testID;
    if (typeof props.accessibilityLabel === 'string') next['aria-label'] = props.accessibilityLabel;
    if (typeof props.onPress === 'function') next.onClick = props.onPress;
    return next;
  }

  function createDiv(children: unknown, style: unknown, props: Record<string, any>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withDomProps(props) },
      children
    );
  }

  const View = ({ children, style, ...rest }: any) => createDiv(children, style, rest);

  const TextInput = ({ style, value, onChangeText, placeholder, ...rest }: any) =>
    createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      onChange: (event: any) => onChangeText?.(event.target.value),
      ...withDomProps(rest),
    });

  const Pressable = ({ children, style, ...rest }: any) => {
    const resolvedStyle = typeof style === 'function' ? style({ pressed: false }) : style;
    const resolvedChildren = typeof children === 'function' ? children({ pressed: false }) : children;
    return createDiv(resolvedChildren, resolvedStyle, rest);
  };

  const ScrollView = ({ children, style, onContentSizeChange, ...rest }: any) => {
    formProps.current = { onContentSizeChange, style, ...rest };
    useEffect(() => {
      onContentSizeChange?.(390, MEASURED_FORM_HEIGHT);
    }, [onContentSizeChange]);
    return createDiv(children, style, rest);
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
      absoluteFillObject: {},
    },
    View,
    TextInput,
    Pressable,
    ScrollView,
    Platform: { OS: 'ios', select: (options: any) => options.ios },
  };
});

async function renderSheet() {
  const { default: NewCalendarEventScreen } = await import(
    '@/app/(app)/calendar/new-event'
  );
  render(<NewCalendarEventScreen />);
}

describe('New event sheet', () => {
  beforeEach(() => {
    addEventSpy.mockReset().mockResolvedValue(undefined);
    backSpy.mockClear();
    preventLeaveSpy.mockClear();
    formProps.current = null;
  });

  afterAll(() => {
    if (previousExpoOs === undefined) {
      delete process.env.EXPO_OS;
    } else {
      process.env.EXPO_OS = previousExpoOs;
    }
  });

  it('offers its actions once, in the header it already shows', async () => {
    await renderSheet();

    expect(screen.getAllByText('Cancel')).toHaveLength(1);
    expect(screen.getAllByText('Save event')).toHaveLength(1);

    fireEvent.click(screen.getByText('Cancel'));
    expect(backSpy).toHaveBeenCalledOnce();
  });

  it('saves from the header check', async () => {
    await renderSheet();

    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Sunday market' },
    });
    await act(async () => fireEvent.click(screen.getByText('Save event')));

    expect(addEventSpy).toHaveBeenCalledTimes(1);
    expect(addEventSpy.mock.calls[0][0].title).toBe('Sunday market');
  });

  it('holds the sheet to the form it shows, not to a fixed band', async () => {
    await renderSheet();

    const form = screen.getByTestId('new-event-form') as HTMLDivElement;
    expect(form.style.height).toBe(`${MEASURED_FORM_HEIGHT}px`);

    // A taller form — an error line, a larger text size — takes the sheet with
    // it instead of leaving empty sheet below the fields.
    act(() => {
      formProps.current?.onContentSizeChange(390, 470);
    });
    expect(screen.getByTestId('new-event-form').style.height).toBe('470px');
  });

  it('locks the header close and check until the save settles', async () => {
    let finish: () => void = () => {};
    addEventSpy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    await renderSheet();

    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Dinner' },
    });
    fireEvent.click(screen.getByText('Save event'));

    expect(preventLeaveSpy).toHaveBeenLastCalledWith(true, expect.any(Function));
    expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Saving…') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Saving…'));
    expect(addEventSpy).toHaveBeenCalledOnce();
    expect(backSpy).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(preventLeaveSpy).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(backSpy).toHaveBeenCalledOnce();
  });
});
