/**
 * Dev-only debug capture: lets an agent pull a screenshot off the phone, or
 * ask the user to tap an element and receive what it is.
 *
 * Transport is the Metro debug sink (see `metro.config.js`): the app POSTs
 * PNG/JSON to `/__aoi_debug/*` on the Metro origin, Metro writes it under
 * `.expo/aoi-debug/`, and the agent reads the file. Screenshots use
 * `react-native-view-shot` (bundled in Expo Go, so no rebuild). Element
 * picking uses React Native's own dev element inspector through the React
 * DevTools hook; it is loaded defensively so a hook-less runtime degrades to
 * "coordinates only" instead of crashing the app.
 *
 * Everything here is `__DEV__`-gated at the call site; the module is only
 * referenced from the dev harness.
 */

import Constants from 'expo-constants';
import {
  FileSystemSessionType,
  FileSystemUploadType,
  cacheDirectory as fileSystemCacheDirectory,
  copyAsync as copyFileAsync,
  documentDirectory as fileSystemDocumentDirectory,
  uploadAsync as uploadFileAsync,
} from 'expo-file-system/legacy';
import { Dimensions, Platform } from 'react-native';
import { captureScreen } from 'react-native-view-shot';

import {
  captureAccessibilityInventory,
  type AccessibilityInventory,
} from '@/features/dev/element-tree';

export type DebugFrame = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type DebugSelection = {
  picked: boolean;
  point: { x: number; y: number };
  frame?: DebugFrame;
  componentPath?: string[];
  componentStack?: string;
  props?: Record<string, unknown>;
  screenshot?: string | null;
  error?: string;
};

type PendingSelection = { resolve: (value: DebugSelection) => void };

let pendingSelection: PendingSelection | null = null;
const selectionListeners = new Set<() => void>();

function notifySelectionListeners(): void {
  for (const listener of selectionListeners) {
    listener();
  }
}

export function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

export function getPendingSelection(): PendingSelection | null {
  return pendingSelection;
}

function resolveSelection(value: DebugSelection): void {
  const pending = pendingSelection;
  pendingSelection = null;
  notifySelectionListeners();
  pending?.resolve(value);
}

/** Agent entry point: resolves with the next element the user taps. */
export function requestSelection(): Promise<DebugSelection> {
  return new Promise((resolve) => {
    pendingSelection = { resolve };
    notifySelectionListeners();
  });
}

/** Metro origin, e.g. `http://192.168.1.108:8081`, from the Expo manifest. */
function metroOrigin(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? `http://${hostUri}` : '';
}

async function postDebug<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${metroOrigin()}/__aoi_debug${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

type ScreenshotResult = {
  ok: boolean;
  path?: string;
  metaPath?: string;
  accessibilityCount?: number;
  error?: string;
};

/**
 * Keep device-side captures small: full-resolution PNG base64 can exceed what
 * Expo Go tolerates over the JS bridge and Hermes inspector. Tmpfiles never
 * cross the bridge as strings, and the binary upload carries bytes natively.
 */
const SCREENSHOT_IMAGE_WIDTH = 960;
const SCREENSHOT_IMAGE_QUALITY = 0.72;
const SCREENSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function makeScreenshotId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${stamp}-${suffix}`;
}

function screenshotUrl(path: string): string {
  const origin = metroOrigin();
  if (!origin) {
    throw new Error('screenshot sink is unavailable: Metro hostUri is missing');
  }
  return `${origin}${path}`;
}

type UploadedScreenshot = {
  path?: string;
};

/**
 * Give the uploader a stable file to read. View-shot tmpfiles can be cleaned
 * up by the OS while a native upload/session is still finalizing, so copy a
 * successful capture into the app cache first and keep the original tmpfile
 * for automatic cleanup.
 */
async function stabilizeScreenshotFile(tmpUri: string, id: string): Promise<string> {
  const cacheDirectory = fileSystemCacheDirectory ?? fileSystemDocumentDirectory;
  if (!cacheDirectory) {
    return tmpUri;
  }
  const destination = `${cacheDirectory}aoi-debug-screenshot-${id}.jpg`;
  try {
    await copyFileAsync({ from: tmpUri, to: destination });
    return destination;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        'Screenshot cache copy failed; uploading the capture tmpfile:',
        error instanceof Error ? error.message : String(error)
      );
    }
    return tmpUri;
  }
}

async function uploadScreenshotFile(fileUri: string, id: string): Promise<UploadedScreenshot> {
  if (!SCREENSHOT_ID_PATTERN.test(id)) {
    throw new Error('screenshot upload was rejected: invalid screenshot id');
  }
  const result = await uploadFileAsync(
    screenshotUrl(`/__aoi_debug/screenshot-upload?id=${encodeURIComponent(id)}`),
    fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
      sessionType: FileSystemSessionType.FOREGROUND,
    }
  );

  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`screenshot upload failed (${result?.status ?? 'unknown'})`);
  }
  try {
    const parsed = JSON.parse(result.body || '{}') as {
      ok?: boolean;
      path?: string;
      error?: string;
    };
    if (!parsed.ok || !parsed.path) {
      throw new Error(parsed.error || 'screenshot upload was rejected');
    }
    return { path: parsed.path };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'screenshot upload was rejected' || error.message.startsWith('screenshot upload'))
    ) {
      throw error;
    }
    throw new Error('screenshot upload returned an unreadable response');
  }
}

/**
 * Capture the current screen and hand the JPEG to the Metro sink. The
 * accessibility inventory is collected and posted separately as small JSON,
 * so pixels and structured metadata never share one enormous request.
 */
export async function screenshot(label = 'manual'): Promise<ScreenshotResult> {
  const id = makeScreenshotId();
  try {
    // Intentionally leave the tmpfile in place: deleting it after the upload
    // resolves can race native upload/session cleanup in Expo Go, and the OS
    // removes temporary captures when the app closes.
    const tmpUri = await captureScreen({
      format: 'jpg',
      quality: SCREENSHOT_IMAGE_QUALITY,
      width: SCREENSHOT_IMAGE_WIDTH,
      result: 'tmpfile',
    });
    const sourceUri = await stabilizeScreenshotFile(tmpUri, id);
    const uploaded = await uploadScreenshotFile(sourceUri, id);

    const accessibility: AccessibilityInventory = captureAccessibilityInventory();
    const { width, height } = Dimensions.get('window');
    const saved = await postDebug<{
      ok: boolean;
      metaPath?: string;
      error?: string;
    }>('/screenshot-meta', {
      id,
      label,
      screen: { width, height },
      platform: Platform.OS,
      accessibility,
    });
    if (!saved.ok) {
      throw new Error(saved.error || 'screenshot metadata was rejected');
    }
    return {
      ok: true,
      path: uploaded.path,
      metaPath: saved.metaPath,
      accessibilityCount: accessibility.count,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Start a screenshot without waiting for capture, upload, or metadata. The
 * agent CDP command only needs this accepted response; the artifact lands in
 * the Metro sink independently. Awaiting one huge capture over CDP can hold
 * a Hermes promise open long enough to destabilize Expo Go.
 */
const activeScreenshotRequests = new Set<Promise<unknown>>();

export function requestScreenshot(label = 'agent'): {
  ok: boolean;
  accepted: boolean;
  label: string;
} {
  const task = screenshot(label).catch((error: unknown) => {
    if (__DEV__) {
      console.warn(
        'Screenshot request failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  });
  activeScreenshotRequests.add(task);
  task.finally(() => {
    activeScreenshotRequests.delete(task);
  });
  return { ok: true, accepted: true, label };
}

// ── Element inspector ─────────────────────────────────────────────────────

type InspectorHierarchyItem = { name?: string | null };

type InspectorViewData = {
  frame?: DebugFrame;
  hierarchy?: InspectorHierarchyItem[];
  props?: Record<string, unknown>;
  componentStack?: string;
};

type InspectorFn = (
  view: unknown,
  x: number,
  y: number,
  callback: (data: InspectorViewData) => boolean
) => void;

let inspector: InspectorFn | null | undefined;

/**
 * The module reads `__REACT_DEVTOOLS_GLOBAL_HOOK__` at import time and throws
 * when it is absent, so it must be required lazily and never at module scope.
 */
function loadInspector(): InspectorFn | null {
  if (inspector !== undefined) {
    return inspector;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint');
    inspector = (mod?.default ?? mod) as InspectorFn;
  } catch {
    inspector = null;
  }
  return inspector;
}

const INTERESTING_PROP_KEYS = new Set([
  'testID',
  'accessibilityLabel',
  'accessibilityRole',
  'accessibilityHint',
  'accessibilityState',
  'title',
  'placeholder',
  'value',
  'source',
  'uri',
  'name',
  'type',
  'variant',
  'disabled',
  'selected',
]);

/** Keep the readable bits of a fiber's props: identifiers, not style guts. */
function readableProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!props) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!INTERESTING_PROP_KEYS.has(key)) {
      continue;
    }
    const kind = typeof value;
    if (kind === 'string' || kind === 'number' || kind === 'boolean' || value === null) {
      picked[key] = typeof value === 'string' && value.length > 160 ? `${value.slice(0, 160)}…` : value;
    } else if (key === 'source' || key === 'uri') {
      try {
        picked[key] = JSON.parse(JSON.stringify(value));
      } catch {
        // Ignore non-serializable prop values.
      }
    }
  }
  return picked;
}

function inspectAtPoint(
  appInstance: unknown,
  x: number,
  y: number
): Promise<Partial<DebugSelection>> {
  const inspect = loadInspector();
  if (!inspect) {
    return Promise.resolve({ error: 'element inspector unavailable in this runtime' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: Partial<DebugSelection>) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => settle({ error: 'no view found at that point' }), 600);
    try {
      inspect(appInstance, x, y, (data) => {
        clearTimeout(timer);
        settle({
          frame: data.frame,
          componentPath: (data.hierarchy ?? [])
            .map((item) => item.name)
            .filter((name): name is string => Boolean(name))
            .slice(0, 12),
          componentStack: data.componentStack,
          props: readableProps(data.props),
        });
        return true;
      });
    } catch (error) {
      clearTimeout(timer);
      settle({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * Called by the picker overlay once the user taps. Gathers the element, takes
 * a screenshot, persists both, and resolves the agent's `select()` promise.
 */
export async function completeSelection(
  appInstance: unknown,
  x: number,
  y: number
): Promise<DebugSelection> {
  const detail = await inspectAtPoint(appInstance, x, y);
  let screenshotPath: string | null = null;
  try {
    const shot = await screenshot('selection');
    screenshotPath = shot.path ?? null;
  } catch {
    screenshotPath = null;
  }
  const selection: DebugSelection = {
    picked: true,
    point: { x, y },
    ...detail,
    screenshot: screenshotPath,
  };
  try {
    await postDebug('/select', { ...selection, pngBase64: undefined });
  } catch {
    // Persisting is best-effort; the CDP return value is the source of truth.
  }
  resolveSelection(selection);
  return selection;
}

/** Abandon an in-flight selection (e.g. the user dismissed the picker). */
export function cancelSelection(): DebugSelection {
  const selection: DebugSelection = { picked: false, point: { x: 0, y: 0 } };
  resolveSelection(selection);
  return selection;
}

// Expose the agent surface to `pnpm run dev:eval`. Cast because the global is
// intentionally untyped app-wide.
if (__DEV__) {
  const debugGlobal = globalThis as { __aoiDebug?: unknown };
  if (!debugGlobal.__aoiDebug) {
    debugGlobal.__aoiDebug = {
      screenshot,
      requestScreenshot,
      select: requestSelection,
    };
  }
}
