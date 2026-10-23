import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { addMonths } from '@/features/calendar/calendar-date-utils';
import type { CalendarEvent } from '@/features/calendar/types';

// The repository boundary is deferred, not immediate: freshness is only
// observable when a read can land after a newer one has started.
const listEventsInMonth = vi.fn();
const insertEvent = vi.fn();

type PendingRead = {
  from: string;
  to: string;
  resolve: (events: CalendarEvent[]) => void;
};

let pending: PendingRead[] = [];

vi.mock('@/features/api-client', () => ({
  isStubMode: () => true,
  apiFetch: vi.fn(async () => []),
}));

vi.mock('@/features/calendar/calendar-repository', () => ({
  initCalendarDb: vi.fn(async () => {}),
  listEventsInMonth: (...args: [string, string]) => listEventsInMonth(...args),
  listEventsInRange: vi.fn(async () => []),
  insertEvent: (...args: [unknown]) => insertEvent(...args),
  updateEvent: vi.fn(async () => {}),
  deleteEvent: vi.fn(async () => {}),
  getEventById: vi.fn(async () => null),
}));

function makeEvent(id: string, startsAt: string): CalendarEvent {
  return {
    id,
    title: id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
    actor: 'you',
    actorName: 'You',
    label: { preset: 'Date' },
    createdAt: startsAt,
    updatedAt: startsAt,
  };
}

async function renderProvider() {
  const { CalendarProvider, useCalendar } = await import(
    '@/features/calendar/calendar-context'
  );
  const view = renderHook(() => useCalendar(), {
    wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
  });
  // Bootstrap initializes the repository, then the first month read starts.
  await waitFor(() => expect(pending).toHaveLength(1));
  return view;
}

describe('calendar month read freshness', () => {
  beforeEach(() => {
    pending = [];
    insertEvent.mockReset();
    insertEvent.mockImplementation(async () => 'event-id');
    listEventsInMonth.mockReset();
    listEventsInMonth.mockImplementation(
      (from: string, to: string) =>
        new Promise<CalendarEvent[]>((resolve) => {
          pending.push({ from, to, resolve });
        }),
    );
  });

  it('drops an older month read that lands after a newer one', async () => {
    const { result } = await renderProvider();
    const firstMonth = result.current.visibleMonth;
    const older = pending[0];

    // The reader moves on while the first read is still in flight.
    act(() => {
      result.current.setVisibleMonth(addMonths(firstMonth, 1));
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const newer = pending[1];

    await act(async () => {
      newer.resolve([makeEvent('newer', '2026-02-10T10:00:00.000Z')]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events.map((event) => event.id)).toEqual(['newer']);

    // The answer for the month the reader already left must not replace the
    // current one, however late it arrives.
    await act(async () => {
      older.resolve([makeEvent('older', '2026-01-10T10:00:00.000Z')]);
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['newer']);
  });

  it('reports the new window pending, and loaded only once its read lands', async () => {
    const { result } = await renderProvider();
    const firstMonth = result.current.visibleMonth;

    await act(async () => {
      pending[0].resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.monthReadState(firstMonth)).toBe('loaded');

    const nextMonth = addMonths(firstMonth, 1);
    act(() => {
      result.current.setVisibleMonth(nextMonth);
    });

    // Synchronously after the month changes: its window, and only its
    // window, is pending. The neighbouring pages the pager mounted are not
    // empty, and the month before the window was never read.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.monthReadState(firstMonth)).toBe('loading');
    expect(result.current.monthReadState(nextMonth)).toBe('loading');
    expect(result.current.monthReadState(addMonths(firstMonth, 2))).toBe('loading');
    expect(result.current.monthReadState(addMonths(firstMonth, -1))).toBe('unread');
    expect(result.current.monthReadState(addMonths(firstMonth, 3))).toBe('unread');

    await act(async () => {
      pending[1].resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A successful empty read is the only empty answer the provider gives.
    expect(result.current.events).toEqual([]);
    expect(result.current.monthReadState(firstMonth)).toBe('loaded');
    expect(result.current.monthReadState(nextMonth)).toBe('loaded');
    expect(result.current.monthReadState(addMonths(firstMonth, 2))).toBe('loaded');
    expect(result.current.monthReadState(addMonths(firstMonth, -1))).toBe('unread');
  });

  it('does not let a refresh for an earlier month overwrite a newer month', async () => {
    const { result } = await renderProvider();
    const firstMonth = result.current.visibleMonth;

    await act(async () => {
      pending[0].resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A partner-side refresh begins, then the reader moves on.
    let refreshDone: Promise<void> = Promise.resolve();
    act(() => {
      refreshDone = result.current.refresh();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const staleRefresh = pending[1];

    // While the refresh is in flight the month already on screen is pending,
    // not quietly empty: the answer could still bring a plan.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.monthReadState(firstMonth)).toBe('loading');

    act(() => {
      result.current.setVisibleMonth(addMonths(firstMonth, 1));
    });
    await waitFor(() => expect(pending).toHaveLength(3));
    const newer = pending[2];

    await act(async () => {
      newer.resolve([makeEvent('newer', '2026-02-10T10:00:00.000Z')]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The refresh already in flight answers the month the reader left, so
    // its completion is stale even though a refresh started it.
    await act(async () => {
      staleRefresh.resolve([makeEvent('stale', '2026-01-10T10:00:00.000Z')]);
      await refreshDone;
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['newer']);
  });

  it('retargets a post-save reload to the month now on screen', async () => {
    const { result } = await renderProvider();
    const firstMonth = result.current.visibleMonth;

    await act(async () => {
      pending[0].resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The insert is deferred: the save's reload lands after the reader moves on.
    let resolveInsert: (id: string) => void = () => {};
    insertEvent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveInsert = resolve;
        }),
    );

    let saveDone: Promise<void> = Promise.resolve();
    act(() => {
      saveDone = result.current.addEvent({
        title: 'Saved plan',
        startsAt: '2026-03-10T10:00:00.000Z',
        endsAt: '2026-03-10T11:00:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Date' },
      });
    });
    await waitFor(() => expect(insertEvent).toHaveBeenCalledTimes(1));

    const nextMonth = addMonths(firstMonth, 1);
    act(() => {
      result.current.setVisibleMonth(nextMonth);
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const monthRead = pending[1];

    await act(async () => {
      resolveInsert('saved');
    });
    await waitFor(() => expect(pending).toHaveLength(3));

    // The month-change read is the older identity now, so its answer is not news.
    await act(async () => {
      monthRead.resolve([makeEvent('stale-window', '2026-03-01T10:00:00.000Z')]);
    });
    // The save's reload is the newest request and answers the visible month.
    await act(async () => {
      pending[2].resolve([makeEvent('saved', '2026-03-10T10:00:00.000Z')]);
      await saveDone;
    });

    // Red before the fix: the reload queried the month the save started in, so
    // the visible month was never answered and nothing reruns to repair it.
    expect(result.current.isLoading).toBe(false);
    // The reload belongs to the save, but it must ask for the month the reader
    // is on now — the month captured when the save started is already gone.
    expect(pending[2].from).toBe(monthRead.from);
    expect(pending[2].to).toBe(monthRead.to);
    expect(result.current.events.map((event) => event.id)).toEqual(['saved']);
    expect(result.current.monthReadState(nextMonth)).toBe('loaded');
  });

  it('retargets a retained refresh callback to the month now on screen', async () => {
    const { result } = await renderProvider();
    const firstMonth = result.current.visibleMonth;

    await act(async () => {
      pending[0].resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A caller captured this refresh from an earlier render and calls it later.
    const retainedRefresh = result.current.refresh;

    const nextMonth = addMonths(firstMonth, 1);
    act(() => {
      result.current.setVisibleMonth(nextMonth);
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const monthRead = pending[1];
    await act(async () => {
      monthRead.resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let refreshDone: Promise<void> = Promise.resolve();
    act(() => {
      refreshDone = retainedRefresh();
    });
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].from).toBe(monthRead.from);
    expect(pending[2].to).toBe(monthRead.to);

    await act(async () => {
      pending[2].resolve([makeEvent('refreshed', '2026-03-10T10:00:00.000Z')]);
      await refreshDone;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events.map((event) => event.id)).toEqual(['refreshed']);
    expect(result.current.monthReadState(nextMonth)).toBe('loaded');
  });
});
