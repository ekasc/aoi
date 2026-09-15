import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Same RN press-state resolution as capture.test so real Trace/Detail render.
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }
  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }
  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement('div', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };
  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement('span', { style: flattenStyle(style), ...withAriaProps(rest) }, children);
  };
  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createDiv(children, resolved, rest);
  };
  const TextInput = (props: Record<string, any>) => {
    const { style, value, onChangeText, placeholder, autoFocus, ...rest } = props;
    return createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      autoFocus: autoFocus ? true : undefined,
      'data-autofocus': autoFocus ? 'true' : 'false',
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      ...withAriaProps(rest),
    });
  };
  return {
    StyleSheet: { create: (s: Record<string, unknown>) => s, hairlineWidth: 1, flatten: flattenStyle },
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView: View,
    KeyboardAvoidingView: View,
    Platform: { OS: 'ios', select: (o: { ios?: unknown }) => o.ios },
  };
});

const pushSpy = vi.fn();
const backSpy = vi.fn();
const dismissToSpy = vi.fn();
const replaceSpy = vi.fn();
let traceSearchParams: Record<string, string> = {};
let detailParams: Record<string, string | undefined> = {};
let detailMoments: any[] = [];
const capturedStackScreens: { options?: Record<string, any> }[] = [];

vi.mock('expo-router', () => {
  const React = require('react');
  return {
    Stack: {
      Screen: (props: { options?: Record<string, any> }) => {
        capturedStackScreens.push(props);
        return null;
      },
    },
    useRouter: () => ({ push: pushSpy, back: backSpy, replace: replaceSpy, dismissTo: dismissToSpy }),
    useLocalSearchParams: () => {
      // Detail and Trace share the hook in this file; Trace reads
      // capture/returnTo, Detail reads id/at/returnTo. Merge both bags so
      // each screen sees its own params regardless of import order.
      return { ...traceSearchParams, ...detailParams };
    },
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => {
        return effect();
      }, []);
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

const addMoment = vi.fn();
const uploadImage = vi.fn();
const refreshServerPlus = vi.fn(async () => {});
const loadChapterRange = vi.fn(async () => []);

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: detailMoments.length > 0 ? detailMoments : [],
    activity: [],
    isLoading: false,
    hasMoreMoments: false,
    loadMoreMoments: vi.fn(async () => false),
    loadBucketSummary: vi.fn(async () => ({ buckets: [], hasOlder: false })),
    loadChapterRange,
    addMoment,
    removeMoment: vi.fn(),
    refresh: vi.fn(),
    error: null,
  }),
}));

// Trace-only context: when testing Trace, detailMoments is empty and
// addMoment is the driver; when testing Detail, addMoment is unused.
vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ refreshServerPlus }),
}));

vi.mock('@/features/media/use-media-upload', () => ({
  useMediaUpload: () => ({ uploadImage, state: 'idle', progress: 0, error: null, reset: vi.fn() }),
  isQuotaExceededError: (e: unknown) => (e as { code?: unknown } | null)?.code === 'LIMIT_EXCEEDED',
}));

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement('button', { onClick: () => onRecorded('file:///voice.m4a') }, 'Record voice'),
}));

vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: ({ uri }: { uri: string }) => createElement('div', { 'data-testid': 'audio' }, uri),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement('button', { onClick: onPress }, label),
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible }: { visible: boolean }) => (visible ? createElement('div', { 'data-testid': 'detail-sheet' }) : null),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) => createElement('div', {}, children),
}));

function baseMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'm-1',
    type: 'trace' as const,
    title: '',
    body: 'kept thought',
    occurredAt: '2026-05-01T12:00:00.000Z',
    targetAt: null,
    createdAt: '2026-05-01T12:00:00.000Z',
    updatedAt: '2026-05-01T12:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    isOwn: true,
    mediaPreview: undefined,
    audioUri: null,
    mediaId: null,
    ...overrides,
  };
}

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  dismissToSpy.mockClear();
  replaceSpy.mockClear();
  addMoment.mockReset();
  uploadImage.mockReset();
  loadChapterRange.mockReset();
  loadChapterRange.mockResolvedValue([]);
  refreshServerPlus.mockClear();
  traceSearchParams = {};
  detailParams = {};
  detailMoments = [];
  capturedStackScreens.length = 0;
  addMoment.mockResolvedValue(baseMoment({ id: 'saved-1', occurredAt: '2026-05-01T12:00:00.000Z' }));
  uploadImage.mockResolvedValue({ mediaId: 'media-1', url: 'https://cdn.test/media-1' });
});

describe('Legacy trace deep link forwards to Memories composer (no auto-save)', () => {
  it('forwards Us-origin capture=note returnTo=us to Memories compose=note', async () => {
    traceSearchParams = { capture: 'note', returnTo: 'us' };
    const { default: TraceScreen } = await import('@/app/(app)/moment/trace');
    render(<TraceScreen />);
    await act(async () => {});
    // Universal final destination: Memories, returnTo ignored, never detail.
    expect(replaceSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(addMoment).not.toHaveBeenCalled();
    expect(dismissToSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('forwards capture=photo to Memories compose=photos without opening pickers', async () => {
    traceSearchParams = { capture: 'photo', returnTo: 'us' };
    const { default: TraceScreen } = await import('@/app/(app)/moment/trace');
    render(<TraceScreen />);
    await act(async () => {});
    expect(replaceSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });
    expect(addMoment).not.toHaveBeenCalled();
  });
});

describe('Memories-origin trace compat (unified, no direct save)', () => {
  it('forwards capture=note to Memories compose=note without saving', async () => {
    traceSearchParams = { capture: 'note' };
    const { default: TraceScreen } = await import('@/app/(app)/moment/trace');
    render(<TraceScreen />);
    await act(async () => {});
    expect(replaceSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(addMoment).not.toHaveBeenCalled();
    expect(dismissToSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('ignores legacy returnTo and still ends in Memories', async () => {
    traceSearchParams = { capture: 'note', returnTo: 'memories' };
    const { default: TraceScreen } = await import('@/app/(app)/moment/trace');
    render(<TraceScreen />);
    await act(async () => {});
    expect(replaceSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(addMoment).not.toHaveBeenCalled();
  });
});

describe('Detail back respects origin', () => {
  it('Us-origin explicit close dismisses to Us, never back through composer', async () => {
    detailMoments = [];
    detailParams = { id: 'missing-us', at: '2026-05-01T12:00:00.000Z', returnTo: 'us' };
    const { default: Detail } = await import('@/app/(app)/moment/[id]');
    render(createElement(Detail));
    // Missing-memory explicit Back uses the same Us origin.
    const backButton = await screen.findByText('Back');
    fireEvent.click(backButton);
    expect(dismissToSpy).toHaveBeenCalledTimes(1);
    expect(dismissToSpy).toHaveBeenCalledWith('/(app)/(tabs)/together');
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('Us-origin detail exposes a custom header back to Us', async () => {
    detailMoments = [baseMoment({ id: 'us-saved-9', occurredAt: '2026-05-01T12:00:00.000Z' })];
    detailParams = { id: 'us-saved-9', at: '2026-05-01T12:00:00.000Z', returnTo: 'us' };
    const { default: Detail } = await import('@/app/(app)/moment/[id]');
    render(createElement(Detail));
    // Header custom back exists for Us origin.
    const withHeaderLeft = capturedStackScreens.filter((s) => typeof s.options?.headerLeft === 'function');
    expect(withHeaderLeft.length).toBeGreaterThan(0);
    // Invoking it renders a Back to Us control that dismisses to Us.
    const { container } = render(withHeaderLeft[0].options.headerLeft() as never);
    const el = container.querySelector('[aria-label="Back to Us"]');
    expect(el).toBeTruthy();
    (el as HTMLElement).click();
    expect(dismissToSpy).toHaveBeenCalledWith('/(app)/(tabs)/together');
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('legacy detail close goes back (unchanged)', async () => {
    detailMoments = [];
    detailParams = { id: 'missing-legacy' };
    const { default: Detail } = await import('@/app/(app)/moment/[id]');
    render(createElement(Detail));
    const backButton = await screen.findByText('Back');
    fireEvent.click(backButton);
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(dismissToSpy).not.toHaveBeenCalled();
  });
});
