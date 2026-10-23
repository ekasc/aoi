import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateEventSpy = vi.fn(async () => {});
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'event-1' }),
  useRouter: () => ({ back: backSpy, push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    getEventById,
    updateEvent: updateEventSpy,
    deleteEvent: vi.fn(async () => {}),
  }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: ({ label }: any) => <span>{label}</span>,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

const storedEvent = {
  id: 'event-1',
  title: 'Dinner out',
  startsAt: new Date(2026, 0, 15, 19, 0, 0).toISOString(),
  endsAt: new Date(2026, 0, 15, 21, 0, 0).toISOString(),
  allDay: false,
  together: false,
  recurrence: 'none' as const,
  // Richer than the UI exposes: the editor must not silently discard these.
  reminderMinutesBefore: [10, 60],
  label: { preset: 'Food' as const },
  isOwn: true,
};

const getEventById = vi.fn(async (): Promise<typeof storedEvent | null> => ({ ...storedEvent }));

beforeEach(() => {
  updateEventSpy.mockClear();
  backSpy.mockClear();
  getEventById.mockClear();
});

describe('EditCalendarEventScreen preservation', () => {
  it('says a plan could not be loaded and offers a retry, instead of loading forever', async () => {
    getEventById.mockResolvedValueOnce(null);
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    // A deleted or not-yet-synced plan used to sit on "Loading event…" with
    // only Close, so the screen never told the reader anything.
    await waitFor(() =>
      expect(screen.getByText('Unable to load this event. Please try again.')).toBeTruthy(),
    );
    expect(screen.queryByText('Loading event…')).toBeNull();

    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    expect(getEventById).toHaveBeenCalledTimes(2);
  });

  it('blocks dismissal while a save is in flight', async () => {
    let finish: () => void = () => {};
    updateEventSpy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }) as never,
    );
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.click(screen.getByText('Save changes'));

    // The guard covers the header back and the sheet's swipe, not only the
    // buttons, so a in-flight write cannot be dropped mid-flight.
    await waitFor(() =>
      expect((globalThis as { __preventLeave?: { prevent: boolean } }).__preventLeave?.prevent).toBe(true),
    );
    await act(async () => finish());
    await waitFor(() =>
      expect((globalThis as { __preventLeave?: { prevent: boolean } }).__preventLeave?.prevent).toBe(false),
    );
  });


  it('keeps untouched reminder arrays instead of resetting them', async () => {
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    // Change only the title; never touch the reminder control.
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Dinner out, rescheduled' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].reminderMinutesBefore).toEqual([10, 60]);
    expect(updateEventSpy.mock.calls[0][0].title).toBe('Dinner out, rescheduled');
  });

  it('replaces reminders only after the user touches the control', async () => {
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Set reminder: 30 min'));
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].reminderMinutesBefore).toEqual([30]);
  });

  it('round-trips a one-day all-day event without shifting the end day', async () => {
    const allDayStart = new Date(2026, 2, 10, 0, 0, 0, 0);
    const allDayEnd = new Date(2026, 2, 11, 0, 0, 0, 0); // exclusive midnight
    getEventById.mockResolvedValueOnce({
      ...storedEvent,
      allDay: true,
      startsAt: allDayStart.toISOString(),
      endsAt: allDayEnd.toISOString(),
    });
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].allDay).toBe(true);
    expect(new Date(updateEventSpy.mock.calls[0][0].startsAt).getTime()).toBe(
      allDayStart.getTime()
    );
    expect(new Date(updateEventSpy.mock.calls[0][0].endsAt).getTime()).toBe(
      allDayEnd.getTime()
    );
  });

  it('round-trips a multi-day all-day event without shifting the end day', async () => {
    const allDayStart = new Date(2026, 2, 10, 0, 0, 0, 0);
    const allDayEnd = new Date(2026, 2, 13, 0, 0, 0, 0); // exclusive midnight
    getEventById.mockResolvedValueOnce({
      ...storedEvent,
      allDay: true,
      startsAt: allDayStart.toISOString(),
      endsAt: allDayEnd.toISOString(),
    });
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(new Date(updateEventSpy.mock.calls[0][0].startsAt).getTime()).toBe(
      allDayStart.getTime()
    );
    expect(new Date(updateEventSpy.mock.calls[0][0].endsAt).getTime()).toBe(
      allDayEnd.getTime()
    );
  });

  it('keeps the weekly recurrence the toggle represents', async () => {
    getEventById.mockResolvedValueOnce({ ...storedEvent, recurrence: 'weekly' as const });
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].recurrence).toBe('weekly');
  });

  it('saves where the event happens, trimmed', async () => {
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Event location'), {
      target: { value: '  Crystal Pavilion  ' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].location).toBe('Crystal Pavilion');
  });

  it('clears the location to null when the field is emptied', async () => {
    getEventById.mockResolvedValueOnce({ ...storedEvent, location: 'Old place' });
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    expect(screen.getByLabelText('Event location')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Event location'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(updateEventSpy).toHaveBeenCalledTimes(1));
    expect(updateEventSpy.mock.calls[0][0].location).toBeNull();
  });

  it('names the all-day control for what it is and explains an empty title', async () => {
    const { default: EditCalendarEventScreen } = await import(
      '@/app/(app)/calendar/edit/[id]'
    );
    render(<EditCalendarEventScreen />);

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    expect(screen.getByLabelText('All day')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(screen.getByText('Event title is required.')).toBeTruthy()
    );
    expect(updateEventSpy).not.toHaveBeenCalled();
  });
});
