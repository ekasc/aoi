import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();
const backSpy = vi.fn();
const purchaseSpy = vi.fn(async () => ({ ok: true }));
const restoreSpy = vi.fn(async () => ({ ok: true, isPlus: false }));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({
    status: 'free',
    isPlus: false,
    isAvailable: true,
    plans: mockPlans,
    purchase: purchaseSpy,
    restore: restoreSpy,
    refresh: vi.fn(async () => {}),
    serverPlus: null,
    refreshServerPlus: vi.fn(async () => {}),
  }),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

// The shared react-native mock passes Pressable `style` straight through,
// but the paywall computes `style` arrays; flatten them for the DOM.
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

  const View = (props: Record<string, unknown>) => {
    const { children, style } = props;
    return createElement('div', { style: flattenStyle(style) }, children);
  };

  const Text = (props: Record<string, unknown>) => {
    const { children, style } = props;
    return createElement('span', { style: flattenStyle(style) }, children);
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, onPress, ...rest } = props as Record<string, any>;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createElement(
      'div',
      {
        style: flattenStyle(resolved),
        onClick: onPress,
        'aria-label': (rest as Record<string, unknown>).accessibilityLabel,
      },
      children
    );
  };

  const TextInput = (props: Record<string, any>) => {
    const { style, value, onChangeText, placeholder } = props;
    return createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    });
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
    },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView: View,
    Alert: { alert: vi.fn() },
  };
});

const MONTHLY_ID = 'rc_aoi_plus_monthly';
const YEARLY_ID = 'rc_aoi_plus_yearly';

let mockPlans = [
  { id: MONTHLY_ID, title: 'Monthly', priceString: '€3.99', period: 'monthly' },
  { id: YEARLY_ID, title: 'Yearly', priceString: '€29.99', period: 'yearly' },
];

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  purchaseSpy.mockClear();
  purchaseSpy.mockResolvedValue({ ok: true });
  mockPlans = [
    { id: MONTHLY_ID, title: 'Monthly', priceString: '€3.99', period: 'monthly' },
    { id: YEARLY_ID, title: 'Yearly', priceString: '€29.99', period: 'yearly' },
  ];
});

async function renderPaywall() {
  const { default: PaywallScreen } = await import('@/app/(app)/paywall');
  return render(<PaywallScreen />);
}

describe('paywall (v1 benefit contract)', () => {
  it('advertises exactly the three real benefits', async () => {
    const { container } = await renderPaywall();

    expect(screen.getByText(/More room for photos and voice memories/)).toBeTruthy();
    expect(screen.getByText(/More letters for the future/)).toBeTruthy();
    expect(screen.getByText(/PDF chapter keepsakes/)).toBeTruthy();
    const copy = container.textContent ?? '';
    expect(copy).not.toMatch(/location|Memory Wall|everything unlocked|unlimited/i);
    // Shared Space truthfully stated; no two-subscription implication.
    expect(copy).toMatch(/shared Space/);
    expect(copy).not.toMatch(/two subscriptions|each partner.*(purchas|subscrib)/i);
  });

  it('shows RevenueCat offering prices, never hardcoded values', async () => {
    await renderPaywall();

    expect(screen.getByText('€3.99')).toBeTruthy();
    expect(screen.getByText('€29.99')).toBeTruthy();
    expect(screen.queryByText('$4.99')).toBeNull();
    expect(screen.queryByText('$39.99')).toBeNull();
  });

  it('purchases the exact selected package identifier', async () => {
    await renderPaywall();

    fireEvent.click(screen.getByLabelText(`Choose Monthly €3.99`));
    const { act } = await import('@testing-library/react');
    await act(async () => {
      fireEvent.click(screen.getByText(/Continue,/));
    });

    expect(purchaseSpy).toHaveBeenCalledTimes(1);
    expect(purchaseSpy).toHaveBeenCalledWith(MONTHLY_ID);
  });
});
