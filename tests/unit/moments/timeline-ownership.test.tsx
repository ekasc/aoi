import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockMoments: any[] = [];

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    activity: [],
    removeMoment: vi.fn(),
  }),
}));

// FlatList from the global RN mock ignores `data`; render the rail items so
// the gate inside renderItem is exercised.
vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children }: any) => React.createElement('div', {}, children);
  const FlatList = ({ data, renderItem, keyExtractor, ListEmptyComponent }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'rail' },
      data && data.length > 0
        ? data.map((item: any, index: number) =>
            React.createElement(
              'div',
              { key: keyExtractor ? keyExtractor(item, index) : index },
              renderItem({ item, index, separators: {} })
            )
          )
        : ListEmptyComponent
          ? React.createElement(ListEmptyComponent)
          : null
    );
  return {
    View,
    FlatList,
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFillObject: {} },
  };
});

vi.mock('react-native-reanimated', () => {
  const React = require('react');
  const chain: any = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  return {
    default: { View: ({ children }: any) => React.createElement('div', {}, children) },
    FadeInDown: chain,
    ReduceMotion: { System: 'system' },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

// Probe: records whether the timeline handed a long-press handler to the card.
vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: ({ moment, onLongPress }: any) => (
    <div
      data-testid={`moment-card-${moment.id}`}
      data-editable={onLongPress ? 'true' : 'false'}
    />
  ),
}));

vi.mock('@/components/moments/resurface-card', () => ({
  ResurfaceCard: () => null,
}));

vi.mock('@/components/moments/tombstone-marker', () => ({
  TombstoneMarker: () => null,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label }: any) => <button>{label}</button>,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { name: 'Test space', partnerName: 'Alex' } }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: vi.fn(), isSending: false }),
}));

vi.mock('@/features/moments/use-resurface-notification', () => ({
  useResurfaceNotification: () => {},
}));

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    ...overrides,
  };
}

describe('Timeline long-press ownership gate', () => {
  it('offers actions only for own moments; partner and unknown stay locked', async () => {
    mockMoments = [
      makeMoment({ id: 'm-own', isOwn: true, occurredAt: '2026-03-10T10:00:00.000Z' }),
      makeMoment({
        id: 'm-partner',
        authorRole: 'partner',
        authorName: 'Alex',
        isOwn: false,
        occurredAt: '2026-03-11T10:00:00.000Z',
      }),
      // Regression: the remote API once hardcoded authorRole "you" for every
      // moment and never sent ownership — unknown must NOT widen access.
      makeMoment({ id: 'm-unknown', authorRole: 'you', occurredAt: '2026-03-12T10:00:00.000Z' }),
    ];

    const { default: TimelineScreen } = await import('@/app/(app)/(tabs)/index');
    render(<TimelineScreen />);

    expect(screen.getByTestId('moment-card-m-own').getAttribute('data-editable')).toBe('true');
    expect(screen.getByTestId('moment-card-m-partner').getAttribute('data-editable')).toBe('false');
    expect(screen.getByTestId('moment-card-m-unknown').getAttribute('data-editable')).toBe('false');
  });
});
