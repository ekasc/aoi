import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFirstPage } from '@/features/moments/use-first-page';

describe('first-page choices', () => {
  beforeEach(async () => { await AsyncStorage.clear(); vi.restoreAllMocks(); });
  it('persists Not now across remounts', async () => {
    const first = renderHook(() => useFirstPage('maya', 'space'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(() => first.result.current.dismiss());
    expect(first.result.current.dismissed).toBe(true);
    first.unmount();
    const next = renderHook(() => useFirstPage('maya', 'space'));
    await waitFor(() => expect(next.result.current.dismissed).toBe(true));
  });
  it('remembers a shown welcome without removing its reply action mid-session', async () => {
    const first = renderHook(() => useFirstPage('june', 'space'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(() => first.result.current.remember());
    expect(first.result.current.dismissed).toBe(false);
    first.unmount();
    const next = renderHook(() => useFirstPage('june', 'space'));
    await waitFor(() => expect(next.result.current.dismissed).toBe(true));
  });
  it('hides the old choice while a new account or space hydrates', async () => {
    const hook = renderHook(({ viewer, space }) => useFirstPage(viewer, space), { initialProps: { viewer: 'maya', space: 'one' } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(() => hook.result.current.dismiss());
    hook.rerender({ viewer: 'june', space: 'one' });
    expect(hook.result.current.ready).toBe(false);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.dismissed).toBe(false);
    hook.rerender({ viewer: 'maya', space: 'two' });
    expect(hook.result.current.ready).toBe(false);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.dismissed).toBe(false);
  });
  it('keeps the prompt available and explains a failed dismissal', async () => {
    const hook = renderHook(() => useFirstPage('maya', 'space'));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await act(() => hook.result.current.dismiss());
    expect(hook.result.current.dismissed).toBe(false);
    expect(hook.result.current.error).toContain('Please try again');
    await act(() => hook.result.current.dismiss());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.dismissed).toBe(true);
  });
  it('does not replace a new account snapshot with a late dismissal', async () => {
    const hook = renderHook(({ viewer }) => useFirstPage(viewer, 'space'), { initialProps: { viewer: 'maya' } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let finish: (() => void) | undefined;
    vi.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let dismissal: Promise<void>;
    act(() => { dismissal = hook.result.current.dismiss(); });
    hook.rerender({ viewer: 'june' });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => { finish?.(); await dismissal; });
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.dismissed).toBe(false);
  });
  it('offers a retry when preferences cannot load instead of guessing at first use', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk unavailable'));
    const hook = renderHook(() => useFirstPage('maya', 'space'));
    await waitFor(() => expect(hook.result.current.error).toContain('Please try again'));
    expect(hook.result.current.ready).toBe(false);
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.dismissed).toBe(false);
  });
});
