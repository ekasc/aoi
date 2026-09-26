import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelationshipAge } from '@/features/relationship/use-relationship-age';

let focused = true;
let appStateListener: ((state: string) => void) | null = null;
const remove = vi.fn(() => {
  appStateListener = null;
});

vi.mock('expo-router', () => ({
  useIsFocused: () => focused,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove };
    },
  },
}));

describe('useRelationshipAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00'));
    focused = true;
    appStateListener = null;
    remove.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('refreshes when a focused screen resumes and crosses its anniversary', () => {
    vi.setSystemTime(new Date('2026-06-13T12:00:00'));
    const { result } = renderHook(() => useRelationshipAge('2025-06-14'));
    expect(result.current.tone).toBe('discovery');

    act(() => appStateListener?.('background'));
    vi.setSystemTime(new Date('2026-06-14T12:00:00'));
    act(() => appStateListener?.('active'));
    expect(result.current.tone).toBe('established');
  });

  it('refreshes after midnight and reschedules the next boundary', () => {
    vi.setSystemTime(new Date('2026-06-13T23:59:59.500'));
    const { result } = renderHook(() => useRelationshipAge('2025-06-14'));
    expect(result.current.tone).toBe('discovery');

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.tone).toBe('established');
    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(result.current.tone).toBe('established');
  });

  it('stops timers and subscriptions when focus is lost or unmounted', () => {
    focused = false;
    const { result, rerender, unmount } = renderHook(() => useRelationshipAge('2025-06-14'));
    expect(remove).not.toHaveBeenCalled();
    focused = true;
    rerender();
    expect(remove).not.toHaveBeenCalled();
    const tone = result.current.tone;
    focused = false;
    rerender();
    expect(remove).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000));
    expect(result.current.tone).toBe(tone);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
