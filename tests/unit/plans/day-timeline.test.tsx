import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

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
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 3, width: 390 }),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => createElement('span', {}, null),
}));

vi.mock('moti', () => ({
  MotiView: ({ children, ...rest }: Record<string, unknown>) => {
    const { animate, from, transition, ...props } = rest;
    const style = (props as { style?: unknown }).style;
    return createElement('div', { ...props, style }, children as never);
  },
}));

vi.mock('react-native-reanimated', () => ({
  Easing: {
    linear: {},
    in: (easing: unknown) => easing,
    out: (easing: unknown) => easing,
    inOut: (easing: unknown) => easing,
  },
  useReducedMotion: () => false,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import { DayTimeline } from '@/components/calendar/day-timeline';
import type { CalendarEvent } from '@/features/calendar/types';

function event(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    actor: 'you',
    actorName: 'Maya',
    createdAt: '2026-09-01T00:00:00.000Z',
    endsAt: new Date(2026, 8, 16, 11, 0).toISOString(),
    isOwn: true,
    label: { preset: 'Work' },
    startsAt: new Date(2026, 8, 16, 10, 0).toISOString(),
    title: partial.id,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

function renderDay(events: CalendarEvent[]) {
  return render(
    createElement(DayTimeline, {
      events,
      onCreateAtHour: () => {},
      onOpenEvent: () => {},
      ownColor: '#111111',
      partnerColor: '#222222',
    }),
  );
}

describe('Day timeline', () => {
  it('shows where an event happens', () => {
    renderDay([
      event({
        id: 'Career fair',
        location: 'Crystal Pavilion',
        startsAt: new Date(2026, 8, 16, 10, 0).toISOString(),
        endsAt: new Date(2026, 8, 16, 12, 0).toISOString(),
      }),
    ]);
    expect(screen.getByText('Career fair')).toBeTruthy();
    expect(screen.getByText('Crystal Pavilion')).toBeTruthy();
  });

  it('fits a short block to its own span instead of smearing past it', () => {
    renderDay([
      event({
        id: 'Standup',
        location: 'Crystal Pavilion',
        startsAt: new Date(2026, 8, 16, 10, 0).toISOString(),
        endsAt: new Date(2026, 8, 16, 10, 30).toISOString(),
      }),
    ]);
    // The title stays; the owner line and the location would paint onto
    // the neighbour hours, so a short block leaves them out.
    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.queryByText(/You · /)).toBeNull();
    expect(screen.queryByText('Crystal Pavilion')).toBeNull();
  });

  it('shows no location line when there is no location', () => {
    renderDay([event({ id: 'Deep work' })]);
    expect(screen.getByText('Deep work')).toBeTruthy();
    expect(screen.queryByText(/Pavilion/)).toBeNull();
  });

  it('carries ownership in tint and words, never a side stripe', () => {
    // A coloured border-left on the block is decoration wearing a
    // convention's clothes: the tinted fill and the ownership caption
    // already say whose plan it is, in sight and in words.
    const source = readFileSync('components/calendar/day-timeline.tsx', 'utf8');
    expect(source).not.toContain('borderLeftWidth');
    expect(source).not.toContain('borderLeftColor');
  });

  it('draws day blocks square, the way a calendar draws them', () => {
    // Rounding is for chips and buttons, not for time. Scoped to the event
    // style: the all-day chip is a pill on purpose.
    const source = readFileSync('components/calendar/day-timeline.tsx', 'utf8');
    const eventStyle = source.match(/\n  event: \{([\s\S]*?)\n  \},/)?.[1] ?? '';
    expect(eventStyle).toContain('borderRadius: 0');
  });
});
