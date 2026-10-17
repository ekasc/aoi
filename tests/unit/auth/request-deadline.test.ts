import { afterEach, describe, expect, it, vi } from 'vitest';

import { withRequestDeadline } from '@/features/request-deadline';

afterEach(() => vi.useRealTimers());

describe('network request deadlines', () => {
  it('aborts a stalled transport and releases its caller even if transport ignores abort', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withRequestDeadline((active) => {
      signal = active;
      return new Promise<never>(() => {});
    }, { timeoutMs: 50 });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes response body consumption in the deadline', async () => {
    vi.useFakeTimers();
    const pending = withRequestDeadline(async () => {
      const response = new Response(new ReadableStream());
      return response.json();
    }, { timeoutMs: 50 });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
  });

  it('clears the deadline after success or failure', async () => {
    vi.useFakeTimers();
    await expect(withRequestDeadline(async () => 42)).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    await expect(withRequestDeadline(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation and removes its listener', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    let signal: AbortSignal | undefined;
    const pending = withRequestDeadline((active) => {
      signal = active;
      return new Promise<never>(() => {});
    }, { signal: caller.signal });
    const reason = new Error('cancelled by caller');
    const rejected = expect(pending).rejects.toBe(reason);
    caller.abort(reason);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never starts network work for an already-cancelled caller', async () => {
    const caller = new AbortController();
    caller.abort();
    const run = vi.fn();
    await expect(withRequestDeadline(run, { signal: caller.signal })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
