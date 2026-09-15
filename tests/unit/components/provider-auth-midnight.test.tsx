import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { LANDING_ERROR } from '@/constants/landing-theme';

// Resolve Pressable function-styles as unpressed so midnight styles are
// observable in happy-dom (the shared setup aliases Pressable to View,
// which would leave `style` as an unresolved function).
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

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
    },
    View,
    Text,
    Pressable,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    // System scheme is light here on purpose: forced `appearance.colorScheme`
    // must still render midnight styling.
    useColorScheme: () => 'light',
  };
});

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name: string) =>
    name === 'danger' ? '#mock-danger' : '#mock-muted',
}));

const signInWithProvider = vi.hoisted(() => vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ signInWithProvider, status: 'idle' }),
}));

vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: async () => false,
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonStyle: { WHITE: 'white', BLACK: 'black' },
  AppleAuthenticationButtonType: { CONTINUE: 'continue' },
}));

describe('ProviderAuthActions forced-dark (midnight) appearance', () => {
  it('renders the midnight Google button even when the system scheme is light', () => {
    render(
      createElement(ProviderAuthActions, {
        appearance: {
          colorScheme: 'dark',
          helperColor: '#c5b5bd',
          googleBorderColor: '#554b54',
          errorColor: LANDING_ERROR,
        },
      })
    );
    const google = screen.getByLabelText('Continue with Google');
    const style = (google.getAttribute('style') ?? '').toLowerCase();
    // #131314 midnight fill + #554b54 border (happy-dom may serialize to rgb).
    expect(style).toMatch(/19,\s*19,\s*20|131314/);
    expect(style).toMatch(/85,\s*75,\s*84|554b54/);
  });

  it('renders the dark Apple fallback even when the system scheme is light', () => {
    render(
      createElement(ProviderAuthActions, {
        appearance: {
          colorScheme: 'dark',
          helperColor: '#c5b5bd',
          googleBorderColor: '#554b54',
          errorColor: LANDING_ERROR,
        },
      })
    );
    const apple = screen.getByLabelText('Continue with Apple');
    const style = (apple.getAttribute('style') ?? '').toLowerCase();
    // Dark Apple fallback is a white pill (happy-dom may serialize to rgb).
    expect(style).toMatch(/255,\s*255,\s*255|ffffff/);
  });

  it('honors the provided error color on sign-in failure', async () => {
    signInWithProvider.mockResolvedValueOnce({ ok: false, error: 'Unable to sign in right now.' });
    render(
      createElement(ProviderAuthActions, {
        appearance: {
          colorScheme: 'dark',
          helperColor: '#c5b5bd',
          googleBorderColor: '#554b54',
          errorColor: LANDING_ERROR,
        },
      })
    );
    fireEvent.click(screen.getByLabelText('Continue with Google'));
    const alert = await screen.findByText('Unable to sign in right now.');
    const style = ((alert as HTMLElement).getAttribute('style') ?? '').toLowerCase();
    // LANDING_ERROR #ffb4ab (happy-dom may serialize to rgb 255, 180, 171).
    expect(style).toMatch(/255,\s*180,\s*171|ffb4ab/);
  });
});
