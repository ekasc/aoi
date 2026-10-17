import { AppState } from 'react-native';

import {
  captureAccessibilityInventory,
  captureScreenOutline,
  devToolsHook,
  type AccessibilityInventory,
  type Fiber,
  type FiberRoot,
} from '@/features/dev/element-tree';
import { readPhases, resetPhases } from '@/features/dev/phase-timer';
import { seedDevSkyPhotos } from '@/features/dev/dev-seed-sky';
import {
  awaitQuiet,
  beginWindow,
  bump,
  bumpBackground,
  clearRecorder,
  endWindow,
  exportRecorder,
  incrementTotals,
  isRecording,
  mark,
  readTotals,
  recordMedia,
  startRecorder,
  stopRecorder,
} from '@/features/dev/measurement-recorder';
import { trackForeground } from '@/features/dev/foreground-tracker';

/**
 * Dev-only device automation, driven from the dev machine over the Metro CDP
 * bridge (`pnpm run dev:eval`).
 *
 * A physical phone has no host-side tap injection, so the fiber tree is the one
 * reliable handle on it: a "press" walks what is actually rendered, finds the
 * element by its accessibility name, and calls the same handler the platform
 * would have called. Benchmarks then read real timings off the device instead
 * of inferring them from a desktop build.
 *
 * Every entry point returns plain JSON so the bridge can print it directly.
 */

const MAX_NODES = 6000;
const ROUND = 100;

type PressableProps = {
  accessibilityLabel?: unknown;
  accessibilityRole?: unknown;
  testID?: unknown;
  onPress?: unknown;
  onLongPress?: unknown;
};

export type PressResult = {
  matched: string;
  role: string | null;
  testID: string | null;
  fired: 'onPress' | 'onLongPress';
  ms: number;
};

export type FrameStats = {
  ms: number;
  frames: number;
  fps: number;
  longestGapMs: number;
  droppedFrames: number;
};

export type MeasureResult = {
  name: string;
  actionMs: number;
  settle: FrameStats;
};

const round = (value: number) => Math.round(value * ROUND) / ROUND;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for two animation frames, so the tree has painted before we look again. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Every mounted fiber, depth-first across every renderer root. */
function allFibers(): Fiber[] {
  const hook = devToolsHook();
  if (!hook?.renderers || typeof hook.getFiberRoots !== 'function') {
    return [];
  }
  const out: Fiber[] = [];
  for (const id of Array.from(hook.renderers.keys())) {
    let roots: Set<FiberRoot>;
    try {
      roots = hook.getFiberRoots(id);
    } catch {
      continue;
    }
    for (const root of roots) {
      const stack: (Fiber | null | undefined)[] = [root.current];
      while (stack.length && out.length < MAX_NODES) {
        const fiber = stack.pop();
        if (!fiber) {
          continue;
        }
        out.push(fiber);
        stack.push(fiber.child, fiber.sibling);
      }
    }
  }
  return out;
}

function propsOf(fiber: Fiber): PressableProps {
  return (fiber.memoizedProps ?? {}) as PressableProps;
}

function labelOf(props: PressableProps): string | null {
  return typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : null;
}

function matches(props: PressableProps, pattern: string | RegExp): boolean {
  for (const candidate of [props.accessibilityLabel, props.testID]) {
    if (typeof candidate !== 'string') {
      continue;
    }
    if (typeof pattern === 'string' ? candidate === pattern : pattern.test(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * The event shape Pressable handlers expect. Real coordinates are not
 * meaningful for a synthetic press, but handlers that read `nativeEvent` at all
 * should still find every field they touch.
 */
function syntheticPress(): Record<string, unknown> {
  const nativeEvent = {
    changedTouches: [],
    identifier: 0,
    locationX: 0,
    locationY: 0,
    pageX: 0,
    pageY: 0,
    target: null,
    timestamp: Date.now(),
    touches: [],
  };
  return {
    currentTarget: null,
    nativeEvent,
    persist() {},
    preventDefault() {},
    stopPropagation() {},
    target: null,
  };
}

/**
 * Press the rendered element whose accessibility label (or testID) matches.
 * Prefers a fiber that actually carries the handler, because RN nests a host
 * view inside the Touchable that owns `onPress`.
 */
export async function press(
  pattern: string | RegExp,
  options: { long?: boolean } = {},
): Promise<PressResult> {
  const key = options.long ? 'onLongPress' : 'onPress';
  const candidates = allFibers().filter((fiber) => matches(propsOf(fiber), pattern));
  if (candidates.length === 0) {
    throw new Error(
      `no rendered element matches ${String(pattern)}. Run __aoiDebug.inventory() to list labels.`,
    );
  }
  const target = candidates.find((fiber) => typeof propsOf(fiber)[key] === 'function');
  if (!target) {
    throw new Error(
      `matched ${candidates.length} element(s) for ${String(pattern)} but none has ${key}.`,
    );
  }
  const props = propsOf(target);
  const handler = props[key] as (event?: unknown) => unknown;
  const started = Date.now();
  try {
    await handler(syntheticPress());
  } catch {
    // Handlers that insist on a real gesture event get no argument at all.
    await handler();
  }
  return {
    fired: key,
    matched: String(labelOf(props) ?? props.testID ?? pattern),
    ms: Date.now() - started,
    role: typeof props.accessibilityRole === 'string' ? props.accessibilityRole : null,
    testID: typeof props.testID === 'string' ? props.testID : null,
  };
}

/**
 * The router is required lazily, never at module scope: this module is pulled
 * in by `debug-capture`, which unit tests import, and vitest does not transform
 * the app's `node_modules`.
 */
function loadRouter(): { push: (href: never) => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-router') as { router: { push: (href: never) => void } };
  return mod.router;
}

/** Push a route the way the app does, then let the transition land. */
export async function navigate(href: string, settleMs = 600): Promise<{ href: string; ms: number }> {
  const started = Date.now();
  loadRouter().push(href as never);
  await nextPaint();
  await sleep(settleMs);
  return { href, ms: Date.now() - started };
}

/** Sample the JS thread's frame cadence for `ms`. */
export async function frameStats(ms = 1000): Promise<FrameStats> {
  const stamps: number[] = [];
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const tick = (timestamp: number) => {
      stamps.push(timestamp);
      if (Date.now() - started < ms) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
  const elapsed = Date.now() - started;
  let longestGap = 0;
  let dropped = 0;
  for (let index = 1; index < stamps.length; index += 1) {
    const gap = stamps[index] - stamps[index - 1];
    if (gap > longestGap) {
      longestGap = gap;
    }
    // A frame budget of 16.7ms; anything past ~1.5 budgets lost a frame.
    if (gap > 25) {
      dropped += Math.max(1, Math.round(gap / 16.7) - 1);
    }
  }
  return {
    droppedFrames: dropped,
    fps: elapsed > 0 ? round((stamps.length / elapsed) * 1000) : 0,
    frames: stamps.length,
    longestGapMs: round(longestGap),
    ms: elapsed,
  };
}

/** Time an action, then report how smoothly the screen settled after it. */
export async function measure(
  name: string,
  run: () => unknown | Promise<unknown>,
  settleMs = 700,
): Promise<MeasureResult> {
  const started = Date.now();
  // Never let a handler's rejection hide the timing we already paid for.
  try {
    await run();
  } catch {
    // Reported as the elapsed action time either way.
  }
  const actionMs = Date.now() - started;
  const settle = await frameStats(settleMs);
  return { actionMs, name, settle };
}

/** Press-by-label, timed. The common benchmark step. */
export async function pressAndMeasure(
  label: string | RegExp,
  settleMs = 700,
): Promise<MeasureResult & { press: PressResult }> {
  let pressResult: PressResult | null = null;
  const result = await measure(
    `press ${String(label)}`,
    async () => {
      pressResult = await press(label);
    },
    settleMs,
  );
  return { ...result, press: pressResult as unknown as PressResult };
}

/** Compact list of what the screen offers, for choosing what to press. */
export function inventory(): {
  count: number;
  pressable: number;
  elements: unknown[];
} {
  const seen = new Set<string>();
  const elements: {
    label: string | null;
    role: string | null;
    testID: string | null;
    pressable: boolean;
  }[] = [];
  for (const fiber of allFibers()) {
    const props = propsOf(fiber);
    const label = labelOf(props);
    const testID = typeof props.testID === 'string' ? props.testID : null;
    if (!label && !testID) {
      continue;
    }
    const pressable = typeof props.onPress === 'function';
    const role = typeof props.accessibilityRole === 'string' ? props.accessibilityRole : null;
    const key = `${label}|${testID}|${role}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    elements.push({ label, pressable, role, testID });
  }
  return {
    count: elements.length,
    elements,
    pressable: elements.filter((element) => element.pressable).length,
  };
}

/** The screen outline as text, for diagnosing what is actually mounted. */
export function outline(): { characters: number; head: string } {
  const text = captureScreenOutline();
  return { characters: text.length, head: text.slice(0, 2000) };
}

/** The screen as a screen reader sees it (role, label, hint, state, testID). */
export function a11y(): AccessibilityInventory {
  return captureAccessibilityInventory();
}

/** One object for the CDP surface: `__aoiDebug.press(...)`, `__aoiDebug.measure(...)`. */
export const automation = {
  a11y,
  frameStats,
  inventory,
  measure,
  navigate,
  outline,
  // Phase spans: the attribution tool for a stall no profiler can be pointed at.
  phases: readPhases,
  press,
  pressAndMeasure,
  resetPhases,
  recorder: {
    awaitQuiet,
    beginWindow,
    bump,
    bumpBackground,
    clear: clearRecorder,
    endWindow,
    export: exportRecorder,
    increment: incrementTotals,
    isRecording,
    mark,
    readTotals,
    recordMedia,
    start: startRecorder,
    stop: stopRecorder,
  },
  trackForeground: () => trackForeground({
    currentState: AppState.currentState,
    subscribe: listener => {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
  }),
  // Loads the Us photo sky with real sealed album records, so the star field
  // can be exercised with content instead of an empty album.
  seedSky: (spaceId: string, userId: string, count = 6, force = false) =>
    seedDevSkyPhotos(spaceId, userId, count, force),
  sleep,
};
