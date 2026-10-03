import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const pushSpy = vi.fn();
const backSpy = vi.fn();
const purchaseSpy = vi.fn(async () => ({ ok: true }));
const restoreSpy = vi.fn(async () => ({ ok: true, isPlus: false }));
const refreshSpy = vi.fn(async () => {});
let activationPending = false;

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
    refresh: refreshSpy,
    activationPending,
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
    ScrollView: (props: Record<string, unknown>) => {
      const { children, ...rest } = props;
      return createElement('div', { ...rest, 'data-scrollview': 'true' }, children);
    },
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
  restoreSpy.mockReset().mockResolvedValue({ ok: true, isPlus: false });
  refreshSpy.mockReset();
  activationPending = false;
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
  it('keeps the selected package fixed while purchasing and reports only that operation as busy', async () => {
    let finish: (value: { ok: boolean }) => void = () => {};
    purchaseSpy.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await renderPaywall();
    fireEvent.click(screen.getByLabelText('Monthly, €3.99'));
    fireEvent.click(screen.getByText('Continue, €3.99'));
    expect(screen.getByText('Purchasing…')).toBeTruthy();
    expect(screen.getByText('Restore purchase')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Yearly, €29.99'));
    fireEvent.click(screen.getByText('Restore purchase'));
    expect(purchaseSpy).toHaveBeenCalledOnce();
    expect(restoreSpy).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    expect(backSpy).toHaveBeenCalledOnce();
  });

  it('clears an unexpected purchase failure and allows another attempt', async () => {
    purchaseSpy.mockRejectedValueOnce(new Error('private SDK details'));
    await renderPaywall();
    fireEvent.click(screen.getByLabelText('Monthly, €3.99'));
    await act(async () => fireEvent.click(screen.getByText('Continue, €3.99')));
    expect(screen.getByText('Could not complete your purchase. Please try again.')).toBeTruthy();
    expect(screen.queryByText('private SDK details')).toBeNull();
    await act(async () => fireEvent.click(screen.getByText('Continue, €3.99')));
    expect(purchaseSpy).toHaveBeenCalledTimes(2);
  });

  it('does not start another purchase while the existing purchase is awaiting activation', async () => {
    activationPending = true;
    await renderPaywall();
    fireEvent.click(screen.getByLabelText('Monthly, €3.99'));
    fireEvent.click(screen.getByText('Confirming Plus…'));
    expect(purchaseSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Purchase received, confirming Plus on your Space…')).toBeTruthy();
  });

  it('provides a plan reload action after a successful empty offering read', async () => {
    mockPlans = [];
    await renderPaywall();
    expect(screen.getByText('No plans available yet. Please try again later.')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Retry plans')));
    expect(refreshSpy).toHaveBeenCalledOnce();
  });
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

  it('scrolls, so nothing on the purchase screen is unreachable', async () => {
    // This screen used to lay its content out in a plain View with
    // `justifyContent: 'center'` and no ScrollView at all. On a short
    // viewport the centre alignment clipped the top and the bottom together,
    // so the hero and the legal line were both gone and the rest was
    // unscrollable.
    const { container } = await renderPaywall();

    const scroller = container.querySelector('[data-scrollview]');
    expect(scroller).toBeTruthy();

    // Everything below the fold is present in the tree, not merely implied.
    const copy = container.textContent ?? '';
    expect(copy).toMatch(/Prices vary by region/);
    expect(copy).toMatch(/Why Plus\?/);
  });

  it('makes no plan preselected and will not buy without a choice', async () => {
    const { act } = await import('@testing-library/react');
    await renderPaywall();

    // It used to default to plans[1] and light it up, so a reader who
    // tapped straight through had agreed to a plan they never picked.
    expect(screen.getByText('Choose a plan')).toBeTruthy();
    expect(screen.queryByText(/Continue, €/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('Choose a plan'));
    });
    expect(purchaseSpy).not.toHaveBeenCalled();
  });

  it('explains Plus in the app sheet, not a system alert', async () => {
    await renderPaywall();

    fireEvent.click(screen.getByLabelText('Why Plus?'));
    // The sheet's own copy, mounted by the platform sheet.
    expect(await screen.findByText(/raises the limits on your shared Space/)).toBeTruthy();
  });

  it('gives the explanation a real touch target', async () => {
    // It was a bare caption Pressable: about 19pt tall, against a 44pt
    // floor, on the only control that says what the product does.
    const { container } = await renderPaywall();
    const cta = [...container.querySelectorAll('[aria-label]')].find(
      (el) => el.getAttribute('aria-label') === 'Why Plus?'
    ) as HTMLElement | undefined;
    expect(cta).toBeTruthy();
    const minHeight = parseFloat(getComputedStyle(cta as HTMLElement).minHeight || '0');
    expect(minHeight).toBeGreaterThanOrEqual(44);
  });

  it('purchases the exact selected package identifier', async () => {
    await renderPaywall();

    // Nothing is preselected: the reader picks a plan, and the shelf is a
    // radio group so the selection is announced rather than implied by a
    // filled card nobody can interrogate.
    fireEvent.click(screen.getByLabelText(`Monthly, €3.99`));
    const { act } = await import('@testing-library/react');
    await act(async () => {
      fireEvent.click(screen.getByText(/Continue,/));
    });

    expect(purchaseSpy).toHaveBeenCalledTimes(1);
    expect(purchaseSpy).toHaveBeenCalledWith(MONTHLY_ID);
  });
});
