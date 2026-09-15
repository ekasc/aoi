import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { MomentCard } from '@/components/moments/moment-card';

// Same RN mock idiom as the other component tests: flatten styles so DOM
// assertions on touch sizes and labels are meaningful.
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
    const { children, style, ...rest } = props;
    const { accessibilityLabel, accessibilityRole } = rest as Record<string, unknown>;
    return createElement(
      'span',
      {
        style: flattenStyle(style),
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
      },
      children
    );
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const { accessibilityLabel, accessibilityRole, onPress, onLongPress } = rest as Record<string, any>;
    return createElement(
      'div',
      {
        style: flattenStyle(resolved),
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
        onClick: onPress,
      },
      typeof children === 'function' ? children({ pressed: false }) : children
    );
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
    ScrollView: View,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

function styleOf(element: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < element.style.length; i += 1) {
    const key = element.style[i];
    out[key] = element.style.getPropertyValue(key);
  }
  return out;
}

describe('accessibility foundations', () => {
  it('Button meets the 44pt minimum touch target', () => {
    render(<Button label="Do it" onPress={() => {}} />);
    const style = styleOf(screen.getByText('Do it').closest('div') as HTMLElement);
    expect(Number.parseFloat(style['min-height'])).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(style['min-width'])).toBeGreaterThanOrEqual(44);
  });

  it('IconButton meets the 44pt minimum touch target with a label', () => {
    render(
      <IconButton label="Capture a moment" onPress={() => {}}>
        <span>+</span>
      </IconButton>
    );
    const node = screen.getByRole('button', { name: 'Capture a moment' });
    const style = styleOf(node as HTMLElement);
    expect(Number.parseFloat(style['min-height'])).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(style['min-width'])).toBeGreaterThanOrEqual(44);
  });

  it('ThemedText sets no fixed height that could clip scaled fonts', () => {
    const { container } = render(<ThemedText type="display">Big header</ThemedText>);
    const span = container.querySelector('span') as HTMLElement;
    const style = styleOf(span);
    expect(style.height ?? '').toBe('');
    expect(style['max-height'] ?? '').toBe('');
  });

  it('ThemedText marks display/title/subheading as headings and body as plain', () => {
    const { container } = render(
      <>
        <ThemedText type="display">Display</ThemedText>
        <ThemedText type="title">Title</ThemedText>
        <ThemedText type="subheading">Subheading</ThemedText>
        <ThemedText type="body">Body</ThemedText>
      </>
    );
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans[0].getAttribute('role')).toBe('header');
    expect(spans[1].getAttribute('role')).toBe('header');
    expect(spans[2].getAttribute('role')).toBe('header');
    expect(spans[3].getAttribute('role')).toBeNull();
  });

  it('MomentCard long-press target names the moment', () => {
    render(
      <MomentCard
        moment={{
          id: 'm1',
          type: 'note',
          title: 'Lake morning',
          body: 'Still water.',
          occurredAt: '2026-03-15T10:00:00.000Z',
          targetAt: null,
          createdAt: '2026-03-15T10:00:00.000Z',
          authorId: 'user_you',
          authorRole: 'you',
          authorName: 'You',
          mediaPreview: null,
          audioUri: null,
        }}
        onLongPress={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Moment: Lake morning' })).toBeTruthy();
  });
});
