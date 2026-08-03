import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockMoments: any[] = [];
const pushSpy = vi.fn();

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    activity: [],
    removeMoment: vi.fn(),
  }),
}));

// FlatList from the global RN mock ignores `data`; render the rail items so the
// empty-state branch (ListEmptyComponent) is exercised when there are none.
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
          ? React.isValidElement(ListEmptyComponent)
            ? ListEmptyComponent
            : React.createElement(ListEmptyComponent)
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
  useRouter: () => ({ push: pushSpy, back: vi.fn() }),
}));

vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: ({ moment }: any) => <div data-testid={`moment-card-${moment.id}`} />,
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

// Render the sheet's actions as real buttons so we can tap them.
vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible, title, actions }: any) =>
    visible
      ? (
        <div data-testid={`sheet:${title}`}>
          {actions.map((action: any) => (
            <button key={action.label} onClick={action.onPress}>
              {action.label}
            </button>
          ))}
        </div>
      )
      : null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ children, onPress, accessibilityLabel, label }: any) => (
    <button aria-label={accessibilityLabel ?? label} onClick={onPress}>
      {children}
    </button>
  ),
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
    isOwn: true,
    ...overrides,
  };
}

async function renderTimeline() {
  const { default: TimelineScreen } = await import('@/app/(app)/(tabs)/index');
  return render(<TimelineScreen />);
}

describe('Timeline compose entry point', () => {
  beforeEach(() => {
    mockMoments = [];
    pushSpy.mockClear();
  });

  it('offers a single compose button that opens the Trace/Moment sheet', async () => {
    mockMoments = [makeMoment()];
    await renderTimeline();

    // One primary action — the "+" compose button.
    const composeButtons = screen.getAllByLabelText('Capture a moment');
    expect(composeButtons.length).toBe(1);

    // The sheet is closed until the button is pressed.
    expect(screen.queryByTestId('sheet:Capture a moment')).toBeNull();
    fireEvent.click(composeButtons[0]);

    const sheet = screen.getByTestId('sheet:Capture a moment');
    expect(sheet.textContent).toContain('Trace');
    expect(sheet.textContent).toContain('Moment');
  });

  it('routes Trace to the quick capture screen', async () => {
    mockMoments = [makeMoment()];
    await renderTimeline();
    fireEvent.click(screen.getByLabelText('Capture a moment'));
    fireEvent.click(screen.getByText('Trace'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/moment/trace');
  });

  it('routes Moment to the full form', async () => {
    mockMoments = [makeMoment()];
    await renderTimeline();
    fireEvent.click(screen.getByLabelText('Capture a moment'));
    fireEvent.click(screen.getByText('Moment'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/moment/new');
  });

  it('shows one gentle empty-state line that also opens the compose sheet', async () => {
    mockMoments = [];
    await renderTimeline();

    expect(screen.getByText(/Your timeline is quiet/)).toBeTruthy();
    const cta = screen.getByText('Add your first moment');
    fireEvent.click(cta);
    expect(screen.getByTestId('sheet:Capture a moment')).toBeTruthy();
  });
});
