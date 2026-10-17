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

describe('NewCalendarEventScreen recurrence', () => {
  beforeEach(() => {
    addEventSpy.mockClear();
  });

  it('is a quick-add: no "Repeats weekly" toggle is offered', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    expect(screen.queryByLabelText('Toggle repeats weekly')).toBeNull();
  });

  it('stays distilled: title, when, save — refinement lives on the edit screen', async () => {
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    expect(screen.getByLabelText('Event title')).toBeTruthy();
    expect(screen.getByLabelText('All day')).toBeTruthy();
    expect(screen.getByText('Save event')).toBeTruthy();
    expect(screen.queryByLabelText('Event location')).toBeNull();
    expect(screen.queryByLabelText('Mark as time together')).toBeNull();
    expect(screen.queryByText('Label')).toBeNull();
  });

  it('always saves a one-off event (recurrence: none)', async () => {
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

  it('saves unlabeled by default instead of stamping Work', async () => {
    // `{ preset: 'Other' }` without custom text is the domain's labelless
    // representation — a surprise date must never arrive tagged Work.
    const { default: NewCalendarEventScreen } = await import(
      '@/app/(app)/calendar/new-event'
    );
    render(<NewCalendarEventScreen />);

    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Rooftop dinner' },
    });
    fireEvent.click(screen.getByText('Save event'));

    await waitFor(() => expect(addEventSpy).toHaveBeenCalledTimes(1));
    expect(addEventSpy.mock.calls[0][0].label).toEqual({ preset: 'Other' });
  });
});
