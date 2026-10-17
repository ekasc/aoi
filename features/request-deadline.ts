export const API_REQUEST_TIMEOUT_MS = 30_000;

/** Bound the entire operation, including body reads and non-cooperative transports. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal, timeoutMs = API_REQUEST_TIMEOUT_MS }: {
    signal?: AbortSignal | null;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const cancelled = () => signal?.reason ?? new Error('Request cancelled');
  if (signal?.aborted) throw cancelled();

  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = (reason: unknown) => {
    rejectAbort(reason);
    controller.abort(reason);
  };
  const onAbort = () => abort(cancelled());
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort(Object.assign(
    new Error('Request timed out. Please try again.'),
    { code: 'NETWORK_TIMEOUT' }
  )), timeoutMs);

  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
