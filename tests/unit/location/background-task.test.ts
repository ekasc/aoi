import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the task handler that background-task registers on import.
let taskHandler:
  | ((payload: { data?: { locations: unknown[] }; error?: unknown }) => Promise<void>)
  | null = null;

const stopSpy = vi.fn(async () => {});

vi.mock('expo-task-manager', () => ({
  defineTask: (_name: string, handler: unknown) => {
    taskHandler = handler as typeof taskHandler;
  },
}));

vi.mock('expo-location', () => ({
  stopLocationUpdatesAsync: stopSpy,
}));

beforeEach(async () => {
  taskHandler = null;
  stopSpy.mockClear();
  vi.resetModules();
  await import('@/features/location/background-task');
});

describe('location background task cold-start (MEDIUM-6)', () => {
  it('stops updates when woken with no registered reporter', async () => {
    expect(taskHandler).not.toBeNull();

    await taskHandler!({ data: { locations: [{ coords: {} }] } });

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('reports to the registered reporter and does not stop', async () => {
    const { setLocationReportCallback } = await import(
      '@/features/location/background-task'
    );

    const reporter = vi.fn();
    setLocationReportCallback(reporter);

    const fix = { coords: { latitude: 1, longitude: 2 } };
    await taskHandler!({ data: { locations: [fix] } });

    expect(reporter).toHaveBeenCalledWith(fix);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('does nothing on an error payload', async () => {
    await taskHandler!({ error: new Error('boom') });
    expect(stopSpy).not.toHaveBeenCalled();
  });
});
