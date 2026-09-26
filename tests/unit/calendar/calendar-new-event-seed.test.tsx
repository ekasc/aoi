import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const addEventSpy = vi.fn(async () => {});

// Params are swapped per test so one file can cover both seed shapes.
const { routeParams } = vi.hoisted(() => ({
  routeParams: {} as Record<string, string>,
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({ addEvent: addEventSpy }),
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

async function renderAndSave() {
  const { default: NewCalendarEventScreen } = await import(
    '@/app/(app)/calendar/new-event'
  );
  render(<NewCalendarEventScreen />);

  fireEvent.change(screen.getByLabelText('Event title'), {
    target: { value: 'Sunday market' },
  });
  fireEvent.click(screen.getByText('Save event'));

  await waitFor(() => expect(addEventSpy).toHaveBeenCalledTimes(1));
  return new Date(addEventSpy.mock.calls[0][0].startsAt);
}

describe('NewCalendarEventScreen seed date parsing', () => {
  beforeEach(() => {
    addEventSpy.mockClear();
    for (const key of Object.keys(routeParams)) {
      delete routeParams[key];
    }
  });

  // Run with TZ=America/Los_Angeles: a date-only param parsed as UTC midnight
  // lands on the previous local day and seeds the wrong date.
  it('treats a date-only param as a local calendar day', async () => {
    routeParams.date = '2026-01-15';

    const startsAt = await renderAndSave();

    expect(startsAt.getFullYear()).toBe(2026);
    expect(startsAt.getMonth()).toBe(0);
    expect(startsAt.getDate()).toBe(15);
    expect(startsAt.getHours()).toBe(9);
  });

  it('keeps the instant of a full ISO param', async () => {
    // 07:00Z is local midnight in Los Angeles (UTC-7 in March).
    routeParams.date = '2026-03-10T07:00:00.000Z';
    const seeded = new Date('2026-03-10T07:00:00.000Z');

    const startsAt = await renderAndSave();

    // The seeded day is the input instant's local calendar day in any zone.
    expect(startsAt.getFullYear()).toBe(seeded.getFullYear());
    expect(startsAt.getMonth()).toBe(seeded.getMonth());
    expect(startsAt.getDate()).toBe(seeded.getDate());
    expect(startsAt.getHours()).toBe(9);
  });

  it('honors an hour param on top of the seeded day', async () => {
    routeParams.date = '2026-01-15';
    routeParams.hour = '17';

    const startsAt = await renderAndSave();

    expect(startsAt.getDate()).toBe(15);
    expect(startsAt.getHours()).toBe(17);
  });
});
