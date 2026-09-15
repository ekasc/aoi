import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

import DevFoundations from '@/app/dev-foundations';
import { Button } from '@/components/ui/button';
import { PaperTextInput } from '@/components/ui/text-input';

// The shared react-native mock passes Pressable `style` straight through,
// but Button computes `style={({ pressed }) => ...}`. Resolve press-state
// styles as unpressed so the real primitives render in this file.
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
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

const themeColorMock = vi.hoisted(() => vi.fn((_overrides: unknown, name: string) => `#${name}`));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: themeColorMock,
}));

vi.mock('@/features/theme/theme-context', () => ({
  useAoiTheme: () => ({
    colors: {
      background: '#FCF9F2',
      backgroundSubtle: '#F3ECDD',
      surface: '#FFFDF8',
      textPrimary: '#1E1B16',
      textSecondary: '#5E564A',
      textMuted: '#8A8175',
      border: '#E3D8C3',
      borderStrong: '#C9B99B',
      primary: '#334E45',
      primaryPressed: '#28403A',
      primaryText: '#FBF8F1',
      accent: '#8A3E28',
      destructive: '#8F3A2A',
      destructiveBackground: '#F5E4DC',
      disabled: '#B9AE9C',
      overlay: 'rgba(30,27,22,.45)',
    },
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-router', () => ({
  Redirect: () => null,
}));

beforeEach(() => {
  // The gallery renders only in development builds; the shared setup stubs
  // `__DEV__` to false, so re-enable it for these tests.
  vi.stubGlobal('__DEV__', true);
  themeColorMock.mockClear();
});

describe('editorial paper foundations', () => {
  it('renders every semantic token role by name', () => {
    render(<DevFoundations />);
    for (const role of [
      'background',
      'backgroundSubtle',
      'surface',
      'textPrimary',
      'textSecondary',
      'textMuted',
      'border',
      'borderStrong',
      'primary',
      'primaryPressed',
      'primaryText',
      'accent',
      'destructive',
      'destructiveBackground',
      'disabled',
      'overlay',
    ]) {
      expect(screen.getByText(role)).toBeTruthy();
    }
  });

  it('resolves primitives through semantic roles, not raw palette values', () => {
    render(<DevFoundations />);
    const requested = themeColorMock.mock.calls.map((call) => call[1] as string);
    for (const role of ['primary', 'textPrimary', 'border', 'destructive']) {
      expect(requested).toContain(role);
    }
    expect(requested).not.toContain('beige200');
    expect(requested).not.toContain('green700');
  });

  it('renders all button variants with labels and a disabled state', () => {
    render(<DevFoundations />);
    expect(screen.getByText('Primary action')).toBeTruthy();
    expect(screen.getByText('Secondary action')).toBeTruthy();
    expect(screen.getByText('Text action')).toBeTruthy();
    expect(screen.getByText('Destructive action')).toBeTruthy();
    const disabledLabel = screen.getByText('Disabled state');
    expect(disabledLabel.parentElement?.style.opacity).toBe('0.55');
  });

  it('renders input states including an error message', () => {
    render(<DevFoundations />);
    expect(screen.getAllByPlaceholderText('Placeholder text')).toHaveLength(3);
    expect(screen.getByText('Something needs attention.')).toBeTruthy();
    expect(screen.getByText('Disabled field')).toBeTruthy();
  });

  it('button onPress fires for an enabled primary button', () => {
    const onPress = vi.fn();
    render(<Button label="Tap me" onPress={onPress} />);
    fireEvent.click(screen.getByText('Tap me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('input reports typed text', () => {
    const onChangeText = vi.fn();
    render(<PaperTextInput label="Name" value="" onChangeText={onChangeText} placeholder="Type a name" />);
    fireEvent.change(screen.getByPlaceholderText('Type a name'), { target: { value: 'June' } });
    expect(onChangeText).toHaveBeenCalledWith('June');
  });
});
