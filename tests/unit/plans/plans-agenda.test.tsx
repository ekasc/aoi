import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';

// The shared RN stand-in renders Pressable as a plain View, so a screen's
// own function styles and aria mapping would be lost. Components here use
// both (Button), so keep the richer mock the other component tests use.
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

  const View = ({ children, style, ...rest }: Record<string, unknown>) =>
    createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never);

  const Text = ({ children, style, ...rest }: Record<string, unknown>) =>
    createElement('span', { ...withAria(rest), style: flattenStyle(style) }, children as never);

  const Pressable = ({ children, style, ...rest }: Record<string, unknown>) => {
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createElement(
      'div',
      { ...withAria(rest), style: flattenStyle(resolved) },
      children as never
    );
  };

  return {
    StyleSheet: {
      absoluteFillObject: {},
      create: (styles: Record<string, unknown>) => styles,
      flatten: flattenStyle,
      hairlineWidth: 1,
    },
    View,
    Text,
    Pressable,
    ScrollView: View,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 3, width: 390 }),
  };
});

import type { CalendarEvent } from '@/features/calendar/types';
import type { Moment } from '@/features/moments/types';
import type { EventProposal } from '@/features/proposals/types';

// Hoisted so the module factories below can reference the spies and the
// per-test data without tripping vitest's mock hoisting.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  reload: vi.fn(),
  refreshCalendar: vi.fn(),
  loadGoals: vi.fn(),
}));

const data = vi.hoisted(() => ({
  calendar: {
    upcomingEvents: [] as unknown[],
    isLoading: false,
    error: null as string | null,
  },
  proposals: {
    proposals: [] as unknown[],
    isLoading: false,
    error: null as string | null,
  },
  goals: [] as unknown[],
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, back: vi.fn(), replace: vi.fn() }),
  useIsFocused: () => true,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    upcomingEvents: data.calendar.upcomingEvents,
    isLoading: data.calendar.isLoading,
    error: data.calendar.error,
    refresh: mocks.refreshCalendar,
  }),
}));

vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({
    proposals: data.proposals.proposals,
    isLoading: data.proposals.isLoading,
    error: data.proposals.error,
    accept: mocks.accept,
    decline: mocks.decline,
    reload: mocks.reload,
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ loadGoals: mocks.loadGoals }),
}));

import { PlansAgenda } from '@/components/calendar/plans-agenda';

// Pinned midday so "Today" and evening events are stable in every timezone.
const NOW = new Date(2026, 8, 16, 9, 0, 0);

function at(hour: number) {
  return new Date(2026, 8, 16, hour, 0, 0).toISOString();
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    actor: 'you',
    actorName: 'You',
    createdAt: '2026-09-01T00:00:00.000Z',
    endsAt: at(20),
    id: 'event-1',
    isOwn: true,
    label: { preset: 'Other' },
    startsAt: at(18),
    title: 'Dinner out',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProposal(
  overrides: Partial<EventProposal> = {}
): EventProposal {
  return {
    createdAt: '2026-09-15T00:00:00.000Z',
    id: 'proposal-1',
    proposerName: 'June',
    proposerRole: 'partner',
    proposedEnd: at(21),
    proposedStart: at(19),
    resolvedAt: null,
    status: 'pending',
    title: 'Cinema night',
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Moment> = {}): Moment {
  return {
    authorId: 'user_you',
    authorName: 'You',
    authorRole: 'you',
    body: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    id: 'goal-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    targetAt: new Date(2026, 11, 20).toISOString(),
    title: 'Visit Kyoto',
    type: 'goal',
    ...overrides,
  };
}

function renderAgenda() {
  return render(<PlansAgenda now={NOW} />);
}

beforeEach(() => {
  data.calendar = { upcomingEvents: [], isLoading: false, error: null };
  data.proposals = { proposals: [], isLoading: false, error: null };
  data.goals = [];
  mocks.push.mockClear();
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  mocks.refreshCalendar.mockReset();
  mocks.refreshCalendar.mockResolvedValue(undefined);
  mocks.accept.mockReset();
  mocks.accept.mockResolvedValue(undefined);
  mocks.decline.mockReset();
  mocks.decline.mockResolvedValue(undefined);
  mocks.loadGoals.mockReset();
  mocks.loadGoals.mockImplementation(async () => data.goals);
});

describe('Plans agenda', () => {
  it('reads upcoming events as a day-grouped list, not a time grid', async () => {
    data.calendar.upcomingEvents = [
      makeEvent({ id: 'e1', title: 'Dinner out' }),
      makeEvent({
        id: 'e2',
        location: 'Crystal Pavilion',
        startsAt: at(13),
        title: 'Career fair',
      }),
    ];

    renderAgenda();

    expect(await screen.findByText('Dinner out')).toBeTruthy();
    expect(screen.getByText('Career fair')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText(/6:00 PM/)).toBeTruthy();
    expect(screen.getByText(/Crystal Pavilion/)).toBeTruthy();
    expect(screen.getByLabelText(/^Open Dinner out/)).toBeTruthy();
  });

  it('shows Accept and Not now for a partner suggestion', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];

    renderAgenda();

    expect(await screen.findByText('Cinema night')).toBeTruthy();
    expect(screen.getByLabelText('Accept')).toBeTruthy();
    expect(screen.getByLabelText('Not now')).toBeTruthy();
  });

  it('shows your own pending suggestion without response actions', async () => {
    data.proposals.proposals = [
      makeProposal({
        id: 'p2',
        proposerName: 'You',
        proposerRole: 'you',
        title: 'Beach day',
      }),
    ];

    renderAgenda();

    expect(await screen.findByText('Beach day')).toBeTruthy();
    expect(screen.queryByLabelText('Accept')).toBeNull();
    expect(screen.queryByLabelText('Not now')).toBeNull();
    expect(screen.getByText('Waiting for them.')).toBeTruthy();
  });

  it('accepts a suggestion once and refreshes the calendar afterwards', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];
    let resolveAccept: () => void = () => {};
    mocks.accept.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAccept = () => resolve();
        })
    );

    renderAgenda();
    const accept = await screen.findByLabelText('Accept');

    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(mocks.accept).toHaveBeenCalledWith('p1');
    expect(mocks.refreshCalendar).not.toHaveBeenCalled();

    await act(async () => {
      resolveAccept();
    });

    await waitFor(() => {
      expect(mocks.refreshCalendar).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps accept failures calm and leaves the calendar alone', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];
    mocks.accept.mockRejectedValue(new Error('raw backend failure 500'));

    renderAgenda();
    fireEvent.click(await screen.findByLabelText('Accept'));

    expect(
      await screen.findByText('That suggestion could not be accepted just now.')
    ).toBeTruthy();
    expect(screen.queryByText(/raw backend failure 500/)).toBeNull();
    expect(mocks.refreshCalendar).not.toHaveBeenCalled();
  });

  it('offers Not now for a partner suggestion and sends a decline', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];

    renderAgenda();
    fireEvent.click(await screen.findByLabelText('Not now'));

    await waitFor(() => {
      expect(mocks.decline).toHaveBeenCalledWith('p1');
    });
    expect(mocks.refreshCalendar).not.toHaveBeenCalled();
  });

  it('opens a goal detail and routes the create entries', async () => {
    data.goals = [makeGoal({ id: 'g1', title: 'Visit Kyoto' })];

    renderAgenda();

    fireEvent.click(await screen.findByLabelText('Open goal Visit Kyoto'));
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'g1', at: '2026-09-01T00:00:00.000Z' },
    });

    fireEvent.click(screen.getByLabelText('Suggest a time'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/proposal/new');

    fireEvent.click(screen.getByLabelText('Set a goal'));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/goal-new');
  });

  it('opens the event editor directly from an event row', async () => {
    data.calendar.upcomingEvents = [makeEvent({ id: 'e9', title: 'Picnic' })];

    renderAgenda();

    fireEvent.click(await screen.findByLabelText(/^Open Picnic/));
    expect(mocks.push).toHaveBeenCalledWith('/(app)/calendar/edit/e9');
  });

  it('says what is missing when the agenda is empty', async () => {
    renderAgenda();

    expect(
      await screen.findByText('Nothing on the calendar yet.')
    ).toBeTruthy();
    expect(screen.getByText('No goals yet.')).toBeTruthy();
    expect(screen.queryByText('Suggestions')).toBeNull();
  });

  it('shows a loading line while the calendar is loading', () => {
    data.calendar.isLoading = true;

    renderAgenda();

    expect(screen.getByText('Loading plans…')).toBeTruthy();
  });

  it('says a failed read failed, and retries every source', async () => {
    data.calendar.error = 'raw calendar failure';

    renderAgenda();

    expect(
      screen.getByText('Some of your plans could not be loaded.')
    ).toBeTruthy();
    expect(screen.queryByText('raw calendar failure')).toBeNull();

    fireEvent.click(screen.getByLabelText('Try again'));

    await waitFor(() => {
      expect(mocks.refreshCalendar).toHaveBeenCalledTimes(1);
      expect(mocks.reload).toHaveBeenCalledTimes(1);
      expect(mocks.loadGoals).toHaveBeenCalled();
    });
  });

  it('turns a rejected retry into a calm line instead of an unhandled promise', async () => {
    data.calendar.error = 'raw calendar failure';
    mocks.refreshCalendar.mockRejectedValue(new Error('raw refresh failure 500'));
    mocks.reload.mockRejectedValue(new Error('raw reload failure 500'));

    renderAgenda();
    fireEvent.click(screen.getByLabelText('Try again'));

    expect(
      await screen.findByText('Some of your plans could not be refreshed just now.')
    ).toBeTruthy();
    expect(screen.queryByText(/raw refresh failure 500/)).toBeNull();
    expect(screen.queryByText(/raw reload failure 500/)).toBeNull();
  });

  it('issues one retry at a time while a retry is still in flight', async () => {
    data.calendar.error = 'raw calendar failure';
    let resolveRefresh: () => void = () => {};
    mocks.refreshCalendar.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = () => resolve();
        })
    );

    renderAgenda();
    const tryAgain = screen.getByLabelText('Try again');

    fireEvent.click(tryAgain);
    fireEvent.click(tryAgain);

    expect(mocks.refreshCalendar).toHaveBeenCalledTimes(1);
    expect(mocks.reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh();
    });

    await waitFor(() => {
      expect(screen.queryByText('Some of your plans could not be refreshed just now.')).toBeNull();
    });
  });

  it('does not claim an accepted suggestion failed when only the refresh did', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];
    mocks.refreshCalendar.mockRejectedValue(new Error('raw refresh failure 500'));

    renderAgenda();
    fireEvent.click(await screen.findByLabelText('Accept'));

    expect(mocks.accept).toHaveBeenCalledWith('p1');
    expect(
      await screen.findByText(
        'That suggestion was accepted, but your calendar could not be refreshed.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByText('That suggestion could not be accepted just now.')
    ).toBeNull();
  });

  it('retries only the calendar read after an accepted suggestion', async () => {
    data.proposals.proposals = [makeProposal({ id: 'p1' })];
    mocks.refreshCalendar.mockRejectedValueOnce(new Error('raw refresh failure 500'));

    renderAgenda();
    fireEvent.click(await screen.findByLabelText('Accept'));

    const reload = await screen.findByLabelText('Reload calendar');
    expect(mocks.accept).toHaveBeenCalledTimes(1);

    fireEvent.click(reload);

    await waitFor(() => {
      expect(mocks.refreshCalendar).toHaveBeenCalledTimes(2);
    });
    // The answer is already settled: retrying must not re-accept it.
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.queryByText(
          'That suggestion was accepted, but your calendar could not be refreshed.'
        )
      ).toBeNull();
    });
  });
});
