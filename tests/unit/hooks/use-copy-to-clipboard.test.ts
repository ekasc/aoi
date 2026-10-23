import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

const { write } = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: write }));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('clipboard feedback lifetime', () => {
  it('does not schedule feedback after unmount', async () => {
    vi.useFakeTimers();
    let finish = () => {};
    write.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const view = renderHook(() => useCopyToClipboard());
    act(() => view.result.current.copy('invite'));
    view.unmount();
    await act(async () => { finish(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an older write completion after a newer copy', async () => {
    vi.useFakeTimers();
    let finishFirst = () => {};
    write.mockReturnValueOnce(new Promise<void>(resolve => { finishFirst = resolve; }));
    write.mockResolvedValueOnce(undefined);
    const view = renderHook(() => useCopyToClipboard(100));
    act(() => view.result.current.copy('first'));
    await act(async () => { view.result.current.copy('second'); });
    await act(async () => { finishFirst(); });
    expect(view.result.current.copied('second')).toBe(true);
    expect(view.result.current.copied('first')).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(view.result.current.copied('second')).toBe(false);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
