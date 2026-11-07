import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Moment } from '@/features/moments/types';
import { useResurfaceNotification } from '@/features/moments/use-resurface-notification';

const LAST_NOTIFIED_KEY = 'aoi.resurface.last-notified.v1';

const state = vi.hoisted(() => ({
  moduleAvailable: true,
  granted: true,
  hasResurface: true,
  resurfaceBody: 'a moment you kept',
  permissionRequests: 0,
  scheduleRequests: [] as Array<{
    content: { title: string; body: string; sound: boolean };
    trigger: { type: string; date: Date };
  }>,
}));

// The hook is a thin wrapper over these two collaborators, so the suite fakes
// them and proves the wrapper's contract: when it asks for permission, when it
// schedules, and what it refuses to send.
vi.mock('@/features/notifications/notifications-module', () => ({
  notificationsModule: () =>
    state.moduleAvailable
      ? {
          requestPermissionsAsync: async () => {
            state.permissionRequests += 1;
            return { granted: state.granted };
          },
          scheduleNotificationAsync: async (request: unknown) => {
            state.scheduleRequests.push(
              request as (typeof state.scheduleRequests)[number]
            );
            return 'scheduled_1';
          },
          SchedulableTriggerInputTypes: { DATE: 'date' },
        }
      : null,
}));

vi.mock('@/features/moments/resurface', () => ({
  findResurfaces: () =>
    state.hasResurface
      ? [
          {
            moment: {
              id: 'moment_1',
              type: 'note',
              title: 'A title',
              body: state.resurfaceBody,
              occurredAt: '2023-11-04T10:00:00.000Z',
              createdAt: '2023-11-04T10:00:00.000Z',
              authorId: 'user_1',
              authorRole: 'you',
              authorName: 'Maya',
            } satisfies Moment,
            yearsAgo: 2,
          },
        ]
      : [],
  formatResurfaceLabel: (yearsAgo: number) => `${yearsAgo} years ago`,
}));

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'moment_1',
    type: 'note',
    title: 'A title',
    body: overrides.body ?? 'a moment you kept',
    occurredAt: '2023-11-04T10:00:00.000Z',
    createdAt: '2023-11-04T10:00:00.000Z',
    authorId: 'user_1',
    authorRole: 'you',
    authorName: 'Maya',
    ...overrides,
  };
}

function todayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

describe('useResurfaceNotification', () => {
  beforeEach(() => {
    state.moduleAvailable = true;
    state.granted = true;
    state.hasResurface = true;
    state.permissionRequests = 0;
    state.scheduleRequests = [];
    void globalThis.__mockAsyncStorage.clear();
  });

  it('schedules one quiet notification in a future daylight slot', async () => {
    const now = Date.now();
    renderHook(() => useResurfaceNotification([moment()]));

    await waitFor(() => expect(state.scheduleRequests).toHaveLength(1));

    const [request] = state.scheduleRequests;

    // Quiet, always: a memory must never make a sound.
    expect(request.content.sound).toBe(false);
    expect(request.trigger.type).toBe('date');
    // Daylight delivery, never at night, and never in the past.
    expect(request.trigger.date.getTime()).toBeGreaterThan(now);
    const hour = request.trigger.date.getHours();
    expect(hour === 9 || hour === 14).toBe(true);
    // The day is marked so a later mount does not deliver it again.
    expect(await globalThis.__mockAsyncStorage.getItem(LAST_NOTIFIED_KEY)).toBe(
      todayKey(new Date())
    );
  });

  it('never schedules while permission is denied', async () => {
    state.granted = false;

    renderHook(() => useResurfaceNotification([moment()]));

    await waitFor(() => expect(state.permissionRequests).toBe(1));

    expect(state.scheduleRequests).toHaveLength(0);
    // No marker: a denial must not consume the day, or granting later that
    // same day would never be honoured.
    expect(await globalThis.__mockAsyncStorage.getItem(LAST_NOTIFIED_KEY)).toBeNull();
  });

  it('does not ask for permission when there is nothing to resurface', async () => {
    state.hasResurface = false;

    renderHook(() => useResurfaceNotification([moment()]));

    // Permission prompts are a cost the reader pays; nothing to show means
    // no prompt at all. Wait a macrotask so a wrongly-started async path has
    // a chance to run before the claim is made.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.permissionRequests).toBe(0);
    expect(state.scheduleRequests).toHaveLength(0);
  });

  it('does not notify twice in one day', async () => {
    await globalThis.__mockAsyncStorage.setItem(LAST_NOTIFIED_KEY, todayKey(new Date()));

    renderHook(() => useResurfaceNotification([moment()]));

    await waitFor(() => expect(state.scheduleRequests).toHaveLength(0));
    // The day was already used, so the permission prompt is skipped too.
    expect(state.permissionRequests).toBe(0);
  });

  it('stays inert when the notifications module is unavailable', async () => {
    state.moduleAvailable = false;

    renderHook(() => useResurfaceNotification([moment()]));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.permissionRequests).toBe(0);
    expect(state.scheduleRequests).toHaveLength(0);
    expect(await globalThis.__mockAsyncStorage.getItem(LAST_NOTIFIED_KEY)).toBeNull();
  });

  it('truncates a long memory rather than sending its whole body', async () => {
    const longBody = 'x'.repeat(400);
    state.resurfaceBody = longBody;

    renderHook(() => useResurfaceNotification([moment({ body: longBody })]));

    await waitFor(() => expect(state.scheduleRequests).toHaveLength(1));
    const body = state.scheduleRequests[0].content.body;

    expect(body).toContain('…');
    expect(body).not.toContain('x'.repeat(120));
    // “<excerpt>”, worth a look back together.
    expect(body.length).toBeLessThan(180);
  });
});
