import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';

const { animatedValues } = vi.hoisted(() => ({
  animatedValues: [] as { v: unknown; setValue: (v: unknown) => void }[],
}));

type TestProps = {
  children?: ReactNode;
  style?: unknown;
  [key: string]: unknown;
};

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    const merged: Record<string, unknown> = {};
    for (const entry of style) {
      const flat = flattenStyle(entry);
      if (flat && typeof flat === 'object') {
        Object.assign(merged, flat);
      }
    }
    return merged;
  }
  return typeof style === 'object' && style !== null
    ? (style as Record<string, unknown>)
    : {};
}

function accessibleProps(props: TestProps): TestProps {
  const {
    accessibilityLabel,
    accessibilityRole,
    accessibilityHint,
    accessibilityState,
    accessible,
    accessibilityElementsHidden,
    importantForAccessibility,
    pointerEvents,
    testID,
    onLayout,
    onPress,
    ...rest
  } = props;
  const next: TestProps = { ...rest };
  const state = accessibilityState as { selected?: unknown } | undefined;
  if (typeof onPress === 'function') {
    next.onClick = onPress;
  }

  if (typeof accessibilityLabel === 'string') {
    next['aria-label'] = accessibilityLabel;
  }
  if (typeof accessibilityRole === 'string') {
    next.role = accessibilityRole;
  }
  if (typeof accessibilityHint === 'string') {
    next['aria-description'] = accessibilityHint;
  }
  if (state && typeof state.selected === 'boolean') {
    next['aria-selected'] = String(state.selected);
  }
  if (typeof accessible === 'boolean') {
    next['data-accessible'] = String(accessible);
  }
  if (typeof importantForAccessibility === 'string') {
    next['data-important-for-accessibility'] = importantForAccessibility;
  }
  if (accessibilityElementsHidden === true) {
    next['data-accessibility-elements-hidden'] = 'true';
  }
  if (typeof pointerEvents === 'string') {
    next['data-pointer-events'] = pointerEvents;
  }
  if (typeof testID === 'string') {
    next['data-testid'] = testID;
  }
  return next;
}

let capturedTrackLayout: ((event: {
  nativeEvent: { layout: { width: number } };
}) => void) | null = null;

beforeEach(() => {
  capturedTrackLayout = null;
  animatedValues.length = 0;
});

vi.mock('react-native', () => {
  const View = ({ children, style, onLayout, ...rest }: TestProps) => {
    if (typeof onLayout === 'function') {
      capturedTrackLayout = onLayout as (event: {
        nativeEvent: { layout: { width: number } };
      }) => void;
    }
    return createElement(
      'div',
      { style: flattenStyle(style), ...accessibleProps(rest) },
      children
    );
  };

  const Pressable = ({ children, style, ...rest }: TestProps) => (
    <div
      style={flattenStyle(style)}
      {...accessibleProps(rest)}
    >
      {children}
    </div>
  );

  class MockAnimatedValue {
    v: unknown;
    constructor(v: unknown) {
      this.v = v;
      animatedValues.push(this);
    }
    setValue(v: unknown) {
      this.v = v;
    }
    interpolate() {
      return {};
    }
  }

  return {
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Animated: {
      View,
      Value: MockAnimatedValue,
      timing: (value: { setValue: (v: unknown) => void }, config: { toValue: unknown }) => ({
        start: (done?: () => void) => {
          value.setValue(config.toValue);
          done?.();
        },
      }),
    },
    Easing: {
      out: (curve: unknown) => curve,
      exp: {},
    },
    View,
    Pressable,
  };
});

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/haptics/haptics', () => ({
  haptics: { select: vi.fn() },
}));

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Feed/Gallery tab accessibility', () => {
  const options: SegmentedOption<'feed' | 'gallery'>[] = [
    {
      value: 'feed',
      label: 'Feed',
      accessibilityHint: 'Show memories in chronological order',
    },
    {
      value: 'gallery',
      label: 'Gallery',
      accessibilityHint: 'Show memory photos in a grid',
    },
  ];

  function renderTabs(props?: { hidden?: boolean }) {
    return render(
      <SegmentedControl
        accessibilityLabel="Memories view"
        hidden={props?.hidden}
        onChange={() => {}}
        options={options}
        value="feed"
      />
    );
  }

  it('announces the tab list, tabs, hints, and selection', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Memories view' })).toBeTruthy();
    const feed = screen.getByRole('tab', { name: 'Feed' });
    const gallery = screen.getByRole('tab', { name: 'Gallery' });

    expect(feed.getAttribute('aria-selected')).toBe('true');
    expect(gallery.getAttribute('aria-selected')).toBe('false');
    expect(feed.getAttribute('aria-description')).toBe(
      'Show memories in chronological order'
    );
    expect(gallery.getAttribute('aria-description')).toBe('Show memory photos in a grid');
  });

  it('gives each tab a 44-point touch target', () => {
    renderTabs();

    for (const name of ['Feed', 'Gallery']) {
      const style = window.getComputedStyle(screen.getByRole('tab', { name }));
      expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('renders one sliding thumb sized to the measured track', () => {
    renderTabs();
    // Before the first measure there is no thumb to flash at zero width.
    expect(screen.queryByTestId('segment-thumb')).toBeNull();

    act(() => {
      capturedTrackLayout?.({ nativeEvent: { layout: { width: 400 } } });
    });

    // (400 - 2*4 padding - 4 gap) / 2 segments = 194 per segment.
    const thumb = screen.getByTestId('segment-thumb');
    expect(thumb.style.width).toBe('194px');
  });

  it('glides the thumb to the newly selected tab instead of swapping backgrounds', () => {
    const { rerender } = render(
      <SegmentedControl
        accessibilityLabel="Memories view"
        onChange={() => {}}
        options={options}
        value="feed"
      />
    );
    act(() => {
      capturedTrackLayout?.({ nativeEvent: { layout: { width: 400 } } });
    });
    expect(animatedValues[0]?.v).toBe(0);

    rerender(
      <SegmentedControl
        accessibilityLabel="Memories view"
        onChange={() => {}}
        options={options}
        value="gallery"
      />
    );

    // One segment width (194) plus the 4pt gap: the thumb glides there.
    expect(animatedValues[0]?.v).toBe(198);
  });

  it('removes faded tabs from the accessibility tree and disables taps', () => {
    const { rerender } = renderTabs();
    rerender(
      <SegmentedControl
        accessibilityLabel="Memories view"
        hidden
        onChange={() => {}}
        options={options}
        value="feed"
      />
    );

    const tablist = screen.getByRole('tablist', { name: 'Memories view' });
    expect(tablist.getAttribute('data-accessible')).toBe('false');
    expect(tablist.getAttribute('data-important-for-accessibility')).toBe(
      'no-hide-descendants'
    );
    expect(tablist.getAttribute('data-accessibility-elements-hidden')).toBe('true');
    expect(tablist.getAttribute('data-pointer-events')).toBe('none');
  });

  it('keeps selected and unselected segment text contrast at least 4.5 in every theme', () => {
    for (const id of BeachThemeOrder) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = BeachThemes[id][mode];
        expect(
          contrastRatio(palette.textPrimary, palette.surface),
          `${id} ${mode} selected text on selected segment`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(palette.muted, palette.surface2),
          `${id} ${mode} unselected text on segment track`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
