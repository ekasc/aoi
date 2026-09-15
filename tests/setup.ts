import { vi } from 'vitest';

function flattenStyle(style: any): any {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const s of style) {
      // RN flattens recursively — a style entry may itself be an array.
      const flat = flattenStyle(s);
      if (flat && typeof flat === 'object') Object.assign(merged, flat);
    }
    return merged;
  }
  return style;
}

// RN props are not DOM attributes — mirror the ones tests interact with:
// accessibilityLabel / accessibilityState ALSO appear as their aria
// equivalents so getByLabelText and aria-checked assertions work on mocked
// Views and Pressables (the originals stay for attribute-style queries), and
// onPress ALSO becomes onClick so fireEvent.click can tap them.
function withAriaProps(props: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...props };
  if (typeof props.accessibilityLabel === 'string') {
    next['aria-label'] = props.accessibilityLabel;
  }
  if (props.accessibilityState && typeof props.accessibilityState.checked === 'boolean') {
    next['aria-checked'] = String(props.accessibilityState.checked);
  }
  if (props.accessibilityState && typeof props.accessibilityState.selected === 'boolean') {
    next['aria-selected'] = String(props.accessibilityState.selected);
  }
  if (typeof props.onPress === 'function') {
    next.onClick = props.onPress;
  }
  return next;
}

function createDiv(children: any, style: any, props: Record<string, any>) {
  const React = require('react');
  return React.createElement(
    'div',
    { style: flattenStyle(style), ...withAriaProps(props) },
    children
  );
}

function createSpan(children: any, style: any, props: Record<string, any>) {
  const React = require('react');
  return React.createElement(
    'span',
    { style: flattenStyle(style), ...withAriaProps(props) },
    children
  );
}

vi.mock('react-native', () => {
  const React = require('react');

  const View = (props: any) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };

  const Text = (props: any) => {
    const { children, style, ...rest } = props;
    return createSpan(children, style, rest);
  };

  const TextInput = (props: any) => {
    const { style, value, onChangeText, placeholder, ...rest } = props;
    return React.createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      onChange: (event: any) => onChangeText?.(event.target.value),
      ...withAriaProps(rest),
    });
  };

  const Image = ({ source, style, ...props }: any) => {
    const React = require('react');
    return React.createElement('img', { style: flattenStyle(style), src: source?.uri, ...props });
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, any>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
      flatten: flattenStyle,
    },
    View,
    Text,
    TextInput,
    Image,
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    useColorScheme: () => 'light',
    PixelRatio: { get: () => 3 },
    StatusBar: { currentHeight: 44 },
    TouchableOpacity: View,
    TouchableHighlight: View,
    ScrollView: View,
    FlatList: View,
    ActivityIndicator: View,
    Modal: View,
    Pressable: View,
    KeyboardAvoidingView: View,
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    // Only the reduce-motion surface WindowRain uses. The resting
    // default is off; tests capture the change handler to simulate
    // a dynamic system-setting flip.
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
      removeEventListener: () => {},
    },
  };
});

vi.mock('expo', () => ({}));


vi.mock('@expo/vector-icons', () => {
  const React = require('react');
  const Icon = ({ name, size, color }: any) =>
    React.createElement('span', { 'data-icon': name, style: { color, fontSize: size } });

  return {
    Ionicons: Icon,
    FontAwesome: Icon,
    MaterialIcons: Icon,
  };
});

vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({
    play: () => {},
    pause: () => {},
    playing: false,
    currentTime: 0,
    duration: 0,
  }),
  useAudioRecorder: () => ({
    prepareToRecordAsync: async () => {},
    record: () => {},
    stop: async () => {},
    isRecording: false,
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => {},
}));

// expo-video is a native module; unit tests only need the JS surface the
// dev-preview VideoPlayer touches. The mock runs the setup callback so
// loop/autoplay wiring is exercised, and VideoView renders a labelled div.
vi.mock('expo-video', () => {
  const React = require('react');
  return {
    useVideoPlayer: (_source: unknown, setup?: (player: any) => void) => {
      const player = {
        loop: false,
        muted: false,
        playing: false,
        currentTime: 0,
        duration: 0,
        play: () => {},
        pause: () => {},
        replace: () => {},
      };
      setup?.(player);
      return player;
    },
    VideoView: ({ style, accessibilityLabel }: any) =>
      React.createElement('div', {
        style,
        'data-testid': 'video-view',
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      }),
  };
});

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: async () => ({ granted: false }),
  scheduleNotificationAsync: async () => '',
  getAllScheduledNotificationsAsync: async () => [],
  cancelScheduledNotificationAsync: async () => {},
  setNotificationHandler: () => {},
  // Push APIs — physical-device only in real life; the guards under test
  // must survive these defaults.
  getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[mock-device-token]' }),
  addNotificationReceivedListener: () => ({ remove: () => {} }),
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  removeNotificationSubscriptionAsync: async () => {},
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));

vi.mock('expo-haptics', () => ({
  impactAsync: async () => {},
  notificationAsync: async () => {},
  selectionAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Deterministic per-call UUIDs: unique across drafts (so identical content
// still yields distinct ids) while remaining stable strings for assertions.
vi.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  };
});

// NOTE (P9A): expo-location / expo-task-manager / react-native-maps mocks
// were removed with the v1 location client. If location ever returns,
// re-add module mocks here first.

class MockAsyncStorage {
  store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

const mockAsyncStorageSingleton = new MockAsyncStorage();

// Typed global handles so unit tests can inspect/reset the singleton mocks
// without casting through `any`.
declare global {
  var __mockAsyncStorage: MockAsyncStorage;
  var __mockDb: MockSQLiteDb;
}

globalThis.__mockAsyncStorage = mockAsyncStorageSingleton;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mockAsyncStorageSingleton,
}));

vi.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ uri: 'mock-uri' }) },
  useAssets: () => [null, false],
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: {}, manifest: {} },
  expo: { extra: {} },
}));

// Glass surfaces render real blur/glass on device; in happy-dom they are
// plain host views (same contract as GlassView.js off-iOS).
vi.mock('expo-glass-effect', () => {
  const React = require('react');
  return {
    GlassView: ({ children, style }: any) =>
      React.createElement('div', { style }, children),
    isLiquidGlassAvailable: () => false,
  };
});

vi.mock('expo-blur', () => {
  const React = require('react');
  return {
    BlurView: ({ children, style }: any) =>
      React.createElement('div', { style }, children),
  };
});

// Gesture Handler: a chainable no-op so sheets render in jsdom. Tests that
// exercise real gesture math override this with a file-local mock.
vi.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const chain: any = new Proxy(() => chain, { get: () => chain });
  return {
    Gesture: { Pan: () => chain, Tap: () => chain, LongPress: () => chain },
    GestureDetector: ({ children }: any) => React.createElement('div', {}, children),
    GestureHandlerRootView: ({ children, style }: any) =>
      React.createElement('div', { style }, children),
  };
});

// Native bottom sheet: the real module pulls SwiftUI (native) or vaul (web).
// This stand-in tracks presented state through the imperative ref so the
// NativeSheet wrapper and its consumers are testable in jsdom.
vi.mock('@expo/ui/community/bottom-sheet', () => {
  const React = require('react');
  function BottomSheetModal({ ref, onClose, onDismiss, children }: any) {
    const [presented, setPresented] = React.useState(false);
    React.useImperativeHandle(
      ref,
      () => ({
        present: () => setPresented(true),
        close: () => setPresented(false),
        dismiss: () => setPresented(false),
        forceClose: () => setPresented(false),
        snapToIndex: () => {},
        snapToPosition: () => {},
        expand: () => {},
        collapse: () => {},
      }),
      []
    );
    if (!presented) {
      return null;
    }
    const dismiss = () => {
      setPresented(false);
      onClose?.();
      onDismiss?.();
    };
    return React.createElement(
      'div',
      { 'data-testid': 'native-sheet' },
      React.createElement(
        'button',
        { 'data-testid': 'native-sheet-dismiss', onClick: dismiss },
        'dismiss'
      ),
      children
    );
  }
  return { BottomSheetModal };
});

// Leave guard: the real hook needs a navigation container. The stand-in
// records the latest guard so tests can assert the block and replay an
// intercepted exit.
vi.mock('@/hooks/use-prevent-leave', () => ({
  usePreventLeave: (prevent: boolean, onBlocked: (leave: () => void) => void) => {
    (globalThis as any).__preventLeave = { prevent, onBlocked };
  },
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: '/mock-documents/',
  cacheDirectory: '/mock-cache/',
  readAsStringAsync: () => Promise.resolve(''),
  writeAsStringAsync: () => Promise.resolve(),
  deleteAsync: () => Promise.resolve(),
  getInfoAsync: () => Promise.resolve({ exists: false, size: 0 }),
}));

class MockSQLiteDb {
  tables: Record<string, any[]> = {};

  _clearAll() {
    this.tables = {};
  }

  async execAsync(sql: string) {
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (createMatch) {
      this.tables[createMatch[1]] = this.tables[createMatch[1]] ?? [];
    }
  }

  async getAllAsync<T>(sql: string, ..._params: any[]): Promise<T[]> {
    const fromMatch = sql.match(/FROM (\w+)/i);
    if (fromMatch) {
      const table = this.tables[fromMatch[1]];
      if (sql.includes('PRAGMA table_info')) {
        return [{ name: 'id' }, { name: 'title' }, { name: 'starts_at' }, { name: 'ends_at' },
          { name: 'actor' }, { name: 'actor_name' }, { name: 'label_preset' },
          { name: 'label_custom_text' }, { name: 'reminder_minutes' },
          { name: 'all_day' }, { name: 'together' },
          { name: 'created_at' }, { name: 'updated_at' }] as any[];
      }
      return (table ?? []) as any;
    }
    return [];
  }

  async getFirstAsync<T>(sql: string, ..._params: any[]): Promise<T | null> {
    const fromMatch = sql.match(/FROM (\w+)/i);
    if (fromMatch) {
      const table = this.tables[fromMatch[1]];
      if (sql.includes('COUNT(')) {
        return { count: table?.length ?? 0 } as any;
      }
      return (table?.[0] ?? null) as any;
    }
    return null;
  }

  async runAsync(sql: string, ...params: any[]) {
    const trimmed = sql.trimStart();
    if (trimmed.startsWith('INSERT')) {
      const intoMatch = sql.match(/INTO (\w+)/i);
      if (intoMatch) {
        const table = intoMatch[1];
        this.tables[table] = this.tables[table] ?? [];
        const row: Record<string, any> = {};
        if (params) {
          const columns = sql.match(/\(([^)]+)\)/);
          if (columns) {
            const names = columns[1].split(',').map((c: string) => c.trim());
            names.forEach((name: string, i: number) => {
              row[name] = params[i];
            });
          }
        }
        this.tables[table].push(row);
      }
    } else if (trimmed.startsWith('DELETE')) {
      const fromMatch = sql.match(/FROM (\w+)/i);
      if (fromMatch && params && params[0] !== undefined) {
        const tableName = fromMatch[1];
        const table = this.tables[tableName];
        if (table) {
          this.tables[tableName] = table.filter((row: any) => row.id !== params[0]);
        }
      }
    } else if (trimmed.startsWith('UPDATE')) {
      const tableMatch = sql.match(/UPDATE (\w+)/i);
      if (tableMatch && params && params.length > 0) {
        const tableName = tableMatch[1];
        const table = this.tables[tableName];
        if (table) {
          const id = params[params.length - 1];
          const idx = table.findIndex((row: any) => row.id === id);
          if (idx >= 0) {
            const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
            if (setMatch) {
              const setClauses = setMatch[1].split(',').map((s: string) => s.trim());
              const columns = setClauses.map((c: string) => c.replace(/\s*=\s*\?/i, '').trim());
              const setParams = params.slice(0, params.length - 1);
              columns.forEach((col: string, i: number) => {
                if (i < setParams.length) {
                  table[idx][col] = setParams[i];
                }
              });
            }
          }
        }
      }
    }
    return { lastInsertRowId: this.getTotalRows(), changes: 1 };
  }

  private getTotalRows() {
    return Object.values(this.tables).reduce((sum, t) => sum + t.length, 0);
  }

  close() {}
}

const mockDbSingleton = new MockSQLiteDb();
globalThis.__mockDb = mockDbSingleton;

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => mockDbSingleton,
  openDatabaseSync: () => mockDbSingleton,
  useSQLiteContext: () => mockDbSingleton,
}));

// react-native-reanimated ships ESM that Vite cannot resolve in unit
// tests, and its UI runtime does not exist in happy-dom. Provide the
// JS-thread surface components under test actually use: mutable shared
// values, one-shot derived values, static reduced-motion, and
// pass-through animation builders.
vi.mock('react-native-reanimated', () => {
  const React = require('react');

  const stripAnimatedProps = (props: Record<string, any>) => {
    const {
      entering,
      exiting,
      layout,
      sharedTransitionTag,
      ...rest
    } = props;
    return rest;
  };

  const AnimatedView = (props: any) => {
    const {
      children,
      style,
      testID,
      entering,
      exiting,
      layout,
      sharedTransitionTag,
      ...rest
    } = props;
    const flatStyle = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return React.createElement(
      'div',
      { ...rest, style: flatStyle, ...(testID ? { 'data-testid': testID } : {}) },
      children
    );
  };

  const enteringStub = () => enteringStub;
  Object.assign(enteringStub, {
    duration: () => enteringStub,
    delay: () => enteringStub,
    reduceMotion: () => enteringStub,
    springify: () => enteringStub,
    damping: () => enteringStub,
    stiffness: () => enteringStub,
    mass: () => enteringStub,
    overshootClamping: () => enteringStub,
  });

  return {
    default: {
      View: AnimatedView,
      createAnimatedComponent: (Component: any) => Component,
    },
    View: AnimatedView,
    FadeIn: enteringStub,
    FadeInDown: enteringStub,
    FadeInUp: enteringStub,
    FadeOut: enteringStub,
    SlideInDown: enteringStub,
    SlideInUp: enteringStub,
    SlideOutDown: enteringStub,
    useSharedValue: (initial: any) => React.useRef({ value: initial }).current,
    useDerivedValue: (fn: any) => React.useState(() => ({ value: fn() }))[0],
    useReducedMotion: () => false,
    useAnimatedStyle: () => ({}),
    interpolate: (_value: number, _input: number[], output: number[]) => output[0],
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (value: any) => value,
    withSpring: (value: any) => value,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    withRepeat: (value: any) => value,
    withDelay: (_delay: number, value: any) => value,
    withSequence: (...values: any[]) => values[values.length - 1],
    cancelAnimation: () => {},
    Easing: {
      linear: {},
      sin: {},
      quad: {},
      cubic: {},
      inOut: (easing: any) => easing,
      in: (easing: any) => easing,
      out: (easing: any) => easing,
    },
    ReduceMotion: { System: 0, Always: 1, Never: 2 },
  };
});

vi.mock('expo-image', () => ({
  Image: ({ source, style, ...props }: any) => {
    const React = require('react');
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    return React.createElement('img', { style: flatStyle, src: source?.uri, alt: '', ...props });
  },
}));



// react-native-skia renders to a native GPU canvas — in unit tests render
// the scene graph structurally instead: shapes become labelled divs so
// tests can assert on composition, paints/shaders render as null.
vi.mock('@shopify/react-native-skia', () => {
  const React = require('react');

  // Note: Skia shapes take paint props (`style="stroke"`, `color`,
  // `opacity`, geometry) that must NOT reach the DOM — `style` in
  // particular is a paint-style string, not CSS.
  const shape = (type: string) => {
    const Shape = ({ children }: any) =>
      React.createElement('div', { 'data-skia': type }, children);
    Shape.displayName = `MockSkia${type}`;
    return Shape;
  };

  const Nil = () => null;

  return {
    Canvas: ({ children, style }: any) =>
      React.createElement('div', { 'data-testid': 'skia-canvas', style }, children),
    Circle: shape('Circle'),
    Oval: shape('Oval'),
    Group: shape('Group'),
    Path: shape('Path'),
    Rect: shape('Rect'),
    RadialGradient: Nil,
    SweepGradient: Nil,
    LinearGradient: Nil,
    Blur: Nil,
    Fill: Nil,
    vec: (x: number, y: number = x) => ({ x, y }),
    Skia: { Path: { Make: () => ({ addArc: () => undefined }) } },
  };
});

vi.stubGlobal('__DEV__', false);
