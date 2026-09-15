import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const getEventById = vi.fn(async () => ({ ...storedEvent }));

beforeEach(() => {
  updateEventSpy.mockClear();
  backSpy.mockClear();
  getEventById.mockClear();
});

describe('EditCalendarEventScreen preservation', () => {
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
});
