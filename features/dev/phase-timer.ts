/**
 * Dev-only phase timing, for attributing a frame stall when no CPU profiler is
 * reachable on the platform (see AGENTS.md: CDP's Profiler domain and Hermes'
 * sampling profiler are both unavailable on iOS).
 *
 * Spans accumulate by name into a global store that the debug bridge reads back
 * with `__aoiDebug.phases()`. That makes the question "where did the stall go?"
 * a command instead of a temporary edit that has to be added and removed.
 *
 * A span measures only the code between its start and end. Async spans include
 * waiting time. Uninstrumented JSX, child renders, reconciliation, and commit
 * are not accounted for, so a small total cannot identify the remaining cost.
 */

export type PhaseSample = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type PhaseStore = {
  order: string[];
  samples: Map<string, PhaseSample>;
};

const STORE_KEY = '__aoiPhaseStore';

function store(): PhaseStore {
  const host = globalThis as { __aoiPhaseStore?: PhaseStore };
  host.__aoiPhaseStore ??= { order: [], samples: new Map() };
  return host.__aoiPhaseStore;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Add one observation to a named phase. */
export function recordPhase(name: string, ms: number): void {
  if (!__DEV__) {
    return;
  }
  const phases = store();
  let sample = phases.samples.get(name);
  if (!sample) {
    sample = { count: 0, maxMs: 0, totalMs: 0 };
    phases.samples.set(name, sample);
    phases.order.push(name);
  }
  sample.count += 1;
  sample.totalMs += ms;
  if (ms > sample.maxMs) {
    sample.maxMs = ms;
  }
}

/**
 * Time a synchronous span. Returns the callback's value so a render body can be
 * wrapped without changing what it returns.
 */
export function phase<T>(name: string, run: () => T): T {
  if (!__DEV__) {
    return run();
  }
  const started = now();
  try {
    return run();
  } finally {
    recordPhase(name, now() - started);
  }
}

const NOOP = () => {};

/** Start an async span; call the returned function to close it. */
export function beginPhase(name: string): () => void {
  if (!__DEV__) {
    // One shared no-op rather than a fresh closure per render: the instrument
    // has to cost nothing in production, and it is called on every render.
    return NOOP;
  }
  const started = now();
  let closed = false;
  return () => {
    if (!closed) {
      closed = true;
      recordPhase(name, now() - started);
    }
  };
}

/** Every phase seen since the last reset, slowest total first. */
export function readPhases(): { name: string; count: number; totalMs: number; maxMs: number }[] {
  const phases = store();
  return phases.order
    .map((name) => {
      const sample = phases.samples.get(name) ?? { count: 0, maxMs: 0, totalMs: 0 };
      return {
        count: sample.count,
        maxMs: Math.round(sample.maxMs * 100) / 100,
        name,
        totalMs: Math.round(sample.totalMs * 100) / 100,
      };
    })
    .sort((left, right) => right.totalMs - left.totalMs);
}

/** Clear the store, so one measurement is not polluted by an earlier one. */
export function resetPhases(): void {
  const host = globalThis as { __aoiPhaseStore?: PhaseStore };
  host.__aoiPhaseStore = { order: [], samples: new Map() };
}
