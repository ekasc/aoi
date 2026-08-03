import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/features/api-client', () => ({
  isStubMode: () => true,
}));

function resetMockDb() {
  ((globalThis as any).__mockDb as any)?._clearAll();
}

async function waitForReady(result: any, path?: string) {
  await waitFor(() => {
    if (path === 'calendar') {
      expect(result.current.calendar.isLoading).toBe(false);
    } else {
      expect(result.current.isLoading).toBe(false);
    }
  });
}

describe('useCalendar (stub)', () => {
  beforeEach(() => {
    resetMockDb();
    vi.resetModules();
  });

  it('provides initial state', async () => {
    const { CalendarProvider, useCalendar } = await import('@/features/calendar/calendar-context');

    const { result } = renderHook(() => useCalendar(), {
      wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
    });

    await waitForReady(result);

    expect(result.current.events).toBeDefined();
    expect(Array.isArray(result.current.events)).toBe(true);
    expect(result.current.selectedDate).toBeInstanceOf(Date);
    expect(result.current.visibleMonth).toBeInstanceOf(Date);
    expect(result.current.monthSummary).toBeDefined();
  });

  it('adds an event and returns it in the events list', async () => {
    const { CalendarProvider, useCalendar } = await import('@/features/calendar/calendar-context');

    const { result } = renderHook(() => useCalendar(), {
      wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
    });

    await waitForReady(result);

    const initialCount = result.current.events.length;

    await act(async () => {
      await result.current.addEvent({
        title: 'Test event',
        startsAt: '2026-03-20T10:00:00.000Z',
        endsAt: '2026-03-20T11:00:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Date' },
      });
    });

    expect(result.current.events.length).toBe(initialCount + 1);
    const added = result.current.events.find((e: any) => e.title === 'Test event');
    expect(added).toBeTruthy();
    expect(added!.actor).toBe('you');
  });

  it('deletes a previously added event', async () => {
    const { CalendarProvider, useCalendar } = await import('@/features/calendar/calendar-context');

    const { result } = renderHook(() => useCalendar(), {
      wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
    });

    await waitForReady(result);

    await act(async () => {
      await result.current.addEvent({
        title: 'Event to delete',
        startsAt: '2026-04-01T10:00:00.000Z',
        endsAt: '2026-04-01T11:00:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Work' },
      });
    });

    const toDelete = result.current.events.find((e: any) => e.title === 'Event to delete');
    expect(toDelete).toBeTruthy();

    await act(async () => {
      await result.current.deleteEvent(toDelete!.id);
    });

    const stillExists = result.current.events.find((e: any) => e.id === toDelete!.id);
    expect(stillExists).toBeUndefined();
  });

  it('provides month navigation with separate act blocks', async () => {
    const { CalendarProvider, useCalendar, useCalendarMonthNavigation } = await import(
      '@/features/calendar/calendar-context'
    );

    const { result } = renderHook(
      () => ({ calendar: useCalendar(), nav: useCalendarMonthNavigation() }),
      {
        wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
      }
    );

    await waitForReady(result, 'calendar');

    const initialMonth = result.current.calendar.visibleMonth.getMonth();

    act(() => {
      result.current.nav.goToNextMonth();
    });

    expect(result.current.calendar.visibleMonth.getMonth()).toBe((initialMonth + 1) % 12);

    act(() => {
      result.current.nav.goToPreviousMonth();
    });

    expect(result.current.calendar.visibleMonth.getMonth()).toBe(initialMonth);

    act(() => {
      result.current.nav.goToPreviousMonth();
    });

    expect(result.current.calendar.visibleMonth.getMonth()).toBe(
      initialMonth === 0 ? 11 : initialMonth - 1
    );
  });

  it('updates an existing event title', async () => {
    const { CalendarProvider, useCalendar } = await import('@/features/calendar/calendar-context');

    const { result } = renderHook(() => useCalendar(), {
      wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
    });

    await waitForReady(result);

    await act(async () => {
      await result.current.addEvent({
        title: 'Original',
        startsAt: '2026-05-01T10:00:00.000Z',
        endsAt: '2026-05-01T11:00:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Date' },
      });
    });

    const original = result.current.events.find((e: any) => e.title === 'Original');
    expect(original).toBeTruthy();

    await act(async () => {
      await result.current.updateEvent({
        id: original!.id,
        title: 'Updated title',
        startsAt: '2026-05-01T10:00:00.000Z',
        endsAt: '2026-05-01T11:00:00.000Z',
        label: { preset: 'Date' },
      });
    });

    const updated = result.current.events.find((e: any) => e.id === original!.id);
    expect(updated?.title).toBe('Updated title');
  });

  it('round-trips allDay, together and reminderMinutesBefore on create and update', async () => {
    const { CalendarProvider, useCalendar } = await import('@/features/calendar/calendar-context');

    const { result } = renderHook(() => useCalendar(), {
      wrapper: ({ children }) => <CalendarProvider>{children}</CalendarProvider>,
    });

    await waitForReady(result);

    await act(async () => {
      await result.current.addEvent({
        title: 'All-day visit',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-02T00:00:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Date' },
        reminderMinutesBefore: [30],
        allDay: true,
        together: true,
      });
    });

    const added = result.current.events.find((e: any) => e.title === 'All-day visit');
    expect(added).toBeTruthy();
    expect(added!.allDay).toBe(true);
    expect(added!.together).toBe(true);
    expect(added!.reminderMinutesBefore).toEqual([30]);

    await act(async () => {
      await result.current.updateEvent({
        id: added!.id,
        title: 'All-day visit',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-02T00:00:00.000Z',
        label: { preset: 'Date' },
        reminderMinutesBefore: [],
        allDay: false,
        together: false,
      });
    });

    const updated = result.current.events.find((e: any) => e.id === added!.id);
    expect(updated?.allDay).toBe(false);
    expect(updated?.together).toBe(false);
    expect(updated?.reminderMinutesBefore).toBeUndefined();
  });
});
