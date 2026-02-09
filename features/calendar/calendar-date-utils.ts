import type { CalendarEvent } from '@/features/calendar/types';

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function addDays(date: Date, amount: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDayExclusive(date: Date) {
  return addDays(startOfDay(date), 1);
}

export function toDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isSameDay(left: Date, right: Date) {
  return toDayKey(left) === toDayKey(right);
}

export function isSameMonth(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export function formatMonthTitle(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function formatWeekdayShort(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
  });
}

export function formatDateTitle(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);

  return `${start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function monthBounds(date: Date) {
  const monthStart = startOfMonth(date);
  const nextMonthStart = addMonths(monthStart, 1);
  return { monthStart, nextMonthStart };
}

export function buildMonthGrid(date: Date) {
  const monthStart = startOfMonth(date);
  const leadingDays = monthStart.getDay();
  const gridStart = addDays(monthStart, -leadingDays);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const trailingDays = 6 - monthEnd.getDay();
  const totalDays = leadingDays + monthEnd.getDate() + trailingDays;

  return Array.from({ length: totalDays }, (_, index) => addDays(gridStart, index));
}

export function isEventOnDate(event: CalendarEvent, date: Date) {
  return toDayKey(new Date(event.startsAt)) === toDayKey(date);
}
