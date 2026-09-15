import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WEEKLY_RECURRENCE_INSTANCE_COUNT } from '@aoi/shared';

import type { CreateCalendarEventInput } from '@/features/calendar/types';

type WebRepository = typeof import('@/features/calendar/calendar-repository.web');

async function loadRepository(): Promise<WebRepository> {
  vi.resetModules();
  await globalThis.__mockAsyncStorage.clear();
  return import('@/features/calendar/calendar-repository.web');
}

function makeInput(
  overrides: Partial<CreateCalendarEventInput> = {},
): CreateCalendarEventInput {
  return {
    title: '  Sunday market  ',
    startsAt: new Date('2026-09-13T10:00:00.000Z').toISOString(),
    endsAt: new Date('2026-09-13T11:30:00.000Z').toISOString(),
    actor: 'you',
    actorName: '  Alex  ',
    label: { preset: 'Date', customText: '  farmers market  ' },
    reminderMinutesBefore: [30, 1440],
    allDay: false,
    together: true,
    ...overrides,
  };
}

describe('calendar-repository.web (AsyncStorage backend)', () => {
  beforeEach(async () => {
    await globalThis.__mockAsyncStorage.clear();
  });

  it('starts empty after init', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();
    await expect(repo.countCalendarEvents()).resolves.toBe(0);
    await expect(
      repo.listEventsInMonth('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
    ).resolves.toEqual([]);
  });

  it('round-trips an event with the same mapping as SQLite', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    const id = await repo.insertEvent(makeInput());
    const event = await repo.getEventById(id);

    expect(event).toMatchObject({
      id,
      title: 'Sunday market',
      startsAt: '2026-09-13T10:00:00.000Z',
      endsAt: '2026-09-13T11:30:00.000Z',
      actor: 'you',
      actorName: 'Alex',
      label: { preset: 'Date', customText: 'farmers market' },
      reminderMinutesBefore: [30, 1440],
      allDay: false,
      together: true,
      recurrence: 'none',
      isOwn: true,
    });
    expect(event?.createdAt).toBeTruthy();
    expect(event?.updatedAt).toBeTruthy();
  });

  it('normalizes blank custom text to undefined and partner ownership', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    const id = await repo.insertEvent(
      makeInput({
        actor: 'partner',
        actorName: 'Jordan',
        label: { preset: 'Other', customText: '   ' },
        reminderMinutesBefore: undefined,
      }),
    );
    const event = await repo.getEventById(id);

    expect(event?.label.customText).toBeUndefined();
    expect(event?.reminderMinutesBefore).toBeUndefined();
    expect(event?.isOwn).toBe(false);
  });

  it('expands weekly events into concrete instances and returns the first id', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    const firstId = await repo.insertEvent(
      makeInput({ recurrence: 'weekly' }),
    );
    await expect(repo.countCalendarEvents()).resolves.toBe(
      WEEKLY_RECURRENCE_INSTANCE_COUNT,
    );

    const first = await repo.getEventById(firstId);
    expect(first?.startsAt).toBe('2026-09-13T10:00:00.000Z');
    expect(first?.recurrence).toBe('weekly');

    const month = await repo.listEventsInMonth(
      '2026-09-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    );
    const ids = new Set(month.map((event) => event.id));
    expect(ids.size).toBe(WEEKLY_RECURRENCE_INSTANCE_COUNT);
  });

  it('filters by month/day/range and sorts ascending', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    await repo.insertEvent(
      makeInput({
        title: 'Later',
        startsAt: '2026-09-20T10:00:00.000Z',
        endsAt: '2026-09-20T11:00:00.000Z',
      }),
    );
    await repo.insertEvent(
      makeInput({
        title: 'Earlier',
        startsAt: '2026-09-10T10:00:00.000Z',
        endsAt: '2026-09-10T11:00:00.000Z',
      }),
    );
    await repo.insertEvent(
      makeInput({
        title: 'October',
        startsAt: '2026-10-05T10:00:00.000Z',
        endsAt: '2026-10-05T11:00:00.000Z',
      }),
    );

    const september = await repo.listEventsInMonth(
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    );
    expect(september.map((event) => event.title)).toEqual([
      'Earlier',
      'Later',
    ]);

    const day = await repo.listEventsForDay(
      '2026-09-10T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
    );
    expect(day.map((event) => event.title)).toEqual(['Earlier']);

    // Overlapping window: starts before `to`, ends at/after `from`.
    const range = await repo.listEventsInRange(
      '2026-09-15T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
    );
    expect(range.map((event) => event.title)).toEqual(['Later']);
  });

  it('updates one instance without touching siblings or the group', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    const firstId = await repo.insertEvent(
      makeInput({ recurrence: 'weekly' }),
    );
    const before = await repo.getEventById(firstId);
    const sibling = (
      await repo.listEventsInMonth(
        '2026-09-01T00:00:00.000Z',
        '2026-12-01T00:00:00.000Z',
      )
    ).find((event) => event.id !== firstId);

    await repo.updateEvent({
      id: firstId,
      title: 'Renamed',
      startsAt: before?.startsAt ?? '',
      endsAt: before?.endsAt ?? '',
      label: { preset: 'Work' },
      allDay: true,
      together: false,
      recurrence: 'none',
    });

    const after = await repo.getEventById(firstId);
    expect(after?.title).toBe('Renamed');
    expect(after?.label.preset).toBe('Work');
    expect(after?.allDay).toBe(true);
    expect(after?.together).toBe(false);
    expect(after?.recurrence).toBe('none');
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.actor).toBe('you');

    const siblingAfter = sibling
      ? await repo.getEventById(sibling.id)
      : null;
    expect(siblingAfter?.title).toBe('Sunday market');
    expect(siblingAfter?.recurrence).toBe('weekly');
  });

  it('deletes by id and ignores unknown ids', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    const id = await repo.insertEvent(makeInput());
    await repo.deleteEvent('missing-id');
    await expect(repo.countCalendarEvents()).resolves.toBe(1);

    await repo.deleteEvent(id);
    await expect(repo.countCalendarEvents()).resolves.toBe(0);
    await expect(repo.getEventById(id)).resolves.toBeNull();
    await expect(
      repo.updateEvent({
        id: 'missing-id',
        title: 'x',
        startsAt: '2026-09-13T10:00:00.000Z',
        endsAt: '2026-09-13T11:00:00.000Z',
        label: { preset: 'Work' },
      }),
    ).resolves.toBeUndefined();
  });

  it('persists across module reloads via AsyncStorage', async () => {
    const first = await loadRepository();
    await first.initCalendarDb();
    const id = await first.insertEvent(makeInput());

    vi.resetModules();
    const second: WebRepository = await import(
      '@/features/calendar/calendar-repository.web'
    );
    await second.initCalendarDb();
    await expect(second.countCalendarEvents()).resolves.toBe(1);
    await expect(second.getEventById(id)).resolves.toMatchObject({
      title: 'Sunday market',
    });
  });

  it('keeps every row under concurrent inserts', async () => {
    const repo = await loadRepository();
    await repo.initCalendarDb();

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repo.insertEvent(makeInput({ title: `Event ${index}` })),
      ),
    );

    await expect(repo.countCalendarEvents()).resolves.toBe(10);
  });

  it('treats a corrupt payload as an empty store', async () => {
    await loadRepository();
    await globalThis.__mockAsyncStorage.setItem(
      'aoi.calendar.events.v1',
      'not-json{{{',
    );

    vi.resetModules();
    const repo: WebRepository = await import(
      '@/features/calendar/calendar-repository.web'
    );
    await repo.initCalendarDb();
    await expect(repo.countCalendarEvents()).resolves.toBe(0);
  });
});
