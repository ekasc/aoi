import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const addEventSpy = vi.fn(async () => {});

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({ addEvent: addEventSpy }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { partnerName: 'Alex' } }),
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

describe('NewCalendarEventScreen recurrence toggle', () => {
  beforeEach(() => {
    addEventSpy.mockClear();
  });

  it('offers a "Repeats weekly" toggle, off by default', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    const toggle = screen.getByLabelText('Toggle repeats weekly');
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // No series explanation while the toggle is off.
    expect(screen.queryByText(/each week stays its own event/)).toBeNull();
  });

  it('toggles on and quietly explains the one-instance-at-a-time limitation', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    fireEvent.click(screen.getByLabelText('Toggle repeats weekly'));

    expect(screen.getByLabelText('Toggle repeats weekly').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/each week stays its own event/)).toBeTruthy();
  });

  it('sends recurrence: weekly only when the toggle is on', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    // Give the form a title so it can submit.
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Sunday market' },
    });
    fireEvent.click(screen.getByLabelText('Toggle repeats weekly'));
    fireEvent.click(screen.getByText('Save event'));

    await waitFor(() => expect(addEventSpy).toHaveBeenCalledTimes(1));
    expect(addEventSpy.mock.calls[0][0].recurrence).toBe('weekly');
  });

  it('sends recurrence: none when the toggle stays off', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Sunday market' },
    });
    fireEvent.click(screen.getByText('Save event'));

    await waitFor(() => expect(addEventSpy).toHaveBeenCalledTimes(1));
    expect(addEventSpy.mock.calls[0][0].recurrence).toBe('none');
  });
});
