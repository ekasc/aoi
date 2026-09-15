import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';

import {
  VOICE_BAR_COUNT,
  formatVoiceElapsed,
  meteringToLevel,
  VoiceHoldOverlay,
} from '@/components/home/voice-hold-overlay';

vi.mock('react-native', () => {
  function flattenStyle(style: any): any {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const s of style) {
        const flat = flattenStyle(s);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }
  function withAriaProps(props: Record<string, any>): Record<string, any> {
    const next: Record<string, any> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }
  function createDiv(children: any, style: any, props: Record<string, any>) {
    const React = require('react');
    const flat = flattenStyle(style);
    // Surface native scaleY transforms for waveform assertions.
    const extra: Record<string, string> =
      flat && Array.isArray(flat.transform)
        ? { 'data-transform': JSON.stringify(flat.transform) }
        : {};
    return React.createElement('div', { style: flat, ...withAriaProps(props), ...extra }, children);
  }
  function createSpan(children: any, style: any, props: Record<string, any>) {
    const React = require('react');
    return React.createElement('span', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  return {
    StyleSheet: {
      create: (styles: Record<string, any>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
      flatten: flattenStyle,
    },
    View: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    Text: (props: any) => {
      const { children, style, ...rest } = props;
      return createSpan(children, style, rest);
    },
    Pressable: (props: any) => {
      const { children, style, ...rest } = props;
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      const content = typeof children === 'function' ? children({ pressed: false }) : children;
      return createDiv(content, resolved, rest);
    },
    Modal: (props: any) => {
      const { children, visible, ...rest } = props;
      if (visible === false) {
        return null;
      }
      return createDiv(children, undefined, rest);
    },
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 320, height: 568 }) },
    useWindowDimensions: () => ({ width: 320, height: 568, scale: 2, fontScale: 1 }),
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: replaceSpy }),
  useFocusEffect: () => {},
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-blur', () => ({
  BlurView: (props: any) => {
    const React = require('react');
    return React.createElement('div', { 'aria-label': 'Blur background', style: props.style });
  },
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name: string) => {
    const map: Record<string, string> = {
      overlay: 'rgba(0, 0, 0, 0.6)',
      textPrimary: 'rgb(10, 10, 10)',
      muted: 'rgb(100, 100, 100)',
      accent: 'rgb(200, 30, 30)',
      partnerAccent: 'rgb(30, 200, 30)',
      onAccent: 'rgb(255, 255, 255)',
      danger: 'rgb(220, 20, 20)',
    };
    return map[name] ?? 'rgb(0, 0, 0)';
  },
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ addMoment: addMomentSpy }),
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: mockAudioGranted })),
  setAudioModeAsync: (...args: any[]) => mockSetAudioMode(...args),
  useAudioRecorder: (options: any, onStatus: any) => {
    mockRecorderOptions = options;
    mockAudioStatusHandler = onStatus;
    return {
      prepareToRecordAsync: (...args: any[]) => mockPrepareToRecord(...args),
      record: (...args: any[]) => mockRecordStart(...args),
      stop: (...args: any[]) => mockStopRecording(...args),
    };
  },
  useAudioRecorderState: () => ({
    canRecord: true,
    isRecording: mockAudioActive,
    durationMillis: mockAudioDuration,
    mediaServicesDidReset: false,
    url: null,
    metering: mockAudioMetering,
  }),
}));

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const backSpy = vi.fn();
const addMomentSpy = vi.fn();
const closeSpy = vi.fn();
const deniedSpy = vi.fn();

let mockAudioGranted = true;
let mockAudioActive = false;
let mockAudioDuration = 0;
let mockAudioMetering: number | undefined = -20;
let mockAudioStatusHandler: ((status: any) => void) | null = null;
let mockRecorderOptions: any = null;
const mockPrepareToRecord = vi.fn(async () => {});
const mockRecordStart = vi.fn(() => {
  mockAudioActive = true;
});
const mockStopRecording = vi.fn(async () => {
  mockAudioActive = false;
});
const mockSetAudioMode = vi.fn(async () => {});

function overlayProps(overrides: Record<string, any> = {}) {
  return {
    visible: true,
    holding: true,
    onClose: closeSpy,
    onPermissionDenied: deniedSpy,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function barScaleAt(container: HTMLElement, index: number): number {
  const bar = container.querySelector(
    `[data-testid="voice-bar-${index}"], [testid="voice-bar-${index}"]`
  ) as HTMLElement | null;
  expect(bar).toBeTruthy();
  const parsed = JSON.parse(bar!.getAttribute('data-transform') ?? '[]');
  return parsed[0].scaleY as number;
}

function barEls(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid^="voice-bar-"], [testid^="voice-bar-"]')
  ) as HTMLElement[];
}

beforeEach(() => {
  mockAudioGranted = true;
  mockAudioActive = false;
  mockAudioDuration = 0;
  mockAudioMetering = -20;
  mockAudioStatusHandler = null;
  mockRecorderOptions = null;
  mockPrepareToRecord.mockClear();
  mockRecordStart.mockClear();
  mockStopRecording.mockClear();
  mockSetAudioMode.mockClear();
  pushSpy.mockClear();
  replaceSpy.mockClear();
  backSpy.mockClear();
  closeSpy.mockClear();
  deniedSpy.mockClear();
  addMomentSpy.mockReset();
  addMomentSpy.mockResolvedValue({ id: 'saved-1', occurredAt: '2026-05-01T12:00:00.000Z' });
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('meteringToLevel + formatVoiceElapsed', () => {
  it('maps real dB metering to a 0.12..1 level with a quiet baseline', () => {
    expect(meteringToLevel(undefined)).toBe(0.12);
    expect(meteringToLevel(Number.NaN)).toBe(0.12);
    expect(meteringToLevel(-50)).toBe(0.12);
    expect(meteringToLevel(-25)).toBeCloseTo(0.5, 5);
    expect(meteringToLevel(0)).toBe(1);
    expect(meteringToLevel(-160)).toBe(0.12);
  });

  it('formats mm:ss and caps at the 30s auto-stop', () => {
    expect(formatVoiceElapsed(0)).toBe('00:00');
    expect(formatVoiceElapsed(5)).toBe('00:05');
    expect(formatVoiceElapsed(65)).toBe('00:30');
    expect(VOICE_BAR_COUNT).toBeGreaterThanOrEqual(24);
    expect(VOICE_BAR_COUNT).toBeLessThanOrEqual(32);
  });
});

describe('VoiceHoldOverlay recording', () => {
  it('renders nothing while hidden and never touches the recorder', () => {
    const { container } = render(createElement(VoiceHoldOverlay, overlayProps({ visible: false })));
    expect(container.textContent).toBe('');
    expect(mockPrepareToRecord).not.toHaveBeenCalled();
    expect(mockRecordStart).not.toHaveBeenCalled();
  });

  it('starts with metering-enabled options: blur backdrop, 28 accent bars, big timer, release hint', async () => {
    const { container } = render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    expect(mockRecorderOptions).toMatchObject({ isMeteringEnabled: true });
    expect(mockPrepareToRecord).toHaveBeenCalledTimes(1);
    expect(mockRecordStart).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Recording voice note. Release to finish.')).toBeTruthy();
    expect(screen.getByLabelText('Blur background')).toBeTruthy();
    const timer = screen.getByText('00:00') as HTMLElement;
    expect(Number.parseInt(timer.style.fontSize || '0', 10)).toBeGreaterThanOrEqual(40);
    const bars = barEls(container);
    expect(bars).toHaveLength(VOICE_BAR_COUNT);
    expect(bars[0].style.backgroundColor).toBe('rgb(200, 30, 30)');
    expect(bars[1].style.backgroundColor).toBe('rgb(30, 200, 30)');
    expect(screen.getByText('Release to finish')).toBeTruthy();
    expect(screen.queryByLabelText('Send voice note')).toBeNull();
  });

  it('bars follow live metering levels', async () => {
    mockAudioMetering = -50;
    const view = render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    const quiet = barScaleAt(view.container, 0);
    expect(quiet).toBeCloseTo(0.126, 2);
    mockAudioMetering = -5;
    await act(async () => {
      view.rerender(createElement(VoiceHoldOverlay, overlayProps()));
    });
    expect(barScaleAt(view.container, 0)).toBeCloseTo(0.555, 2);
  });

  it('reduced motion renders static bars regardless of metering', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    mockAudioMetering = -5;
    const { container } = render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    for (const bar of barEls(container)) {
      const parsed = JSON.parse(bar.getAttribute('data-transform') ?? '[]');
      expect(parsed[0].scaleY).toBe(0.4);
    }
  });

  it('denied permission calls back without recording or sending', async () => {
    mockAudioGranted = false;
    render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    expect(deniedSpy).toHaveBeenCalledTimes(1);
    expect(mockRecordStart).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Send voice note')).toBeNull();
  });

  it('auto-stops at 30s even while still holding', async () => {
    const view = render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    expect(mockStopRecording).not.toHaveBeenCalled();
    mockAudioDuration = 30_000;
    await act(async () => {
      view.rerender(createElement(VoiceHoldOverlay, overlayProps()));
    });
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Voice note ready to send.')).toBeTruthy();
  });
});

describe('VoiceHoldOverlay review + send', () => {
  async function toReview(url: string | null = 'file:///voice.m4a', hasError = false) {
    const view = render(createElement(VoiceHoldOverlay, overlayProps()));
    await flush();
    await act(async () => {
      view.rerender(createElement(VoiceHoldOverlay, overlayProps({ holding: false })));
    });
    await act(async () => {
      mockAudioStatusHandler?.({ isFinished: true, hasError, url });
    });
    return view;
  }

  it('release finishes the take then send saves the trace and replaces to detail', async () => {
    addMomentSpy.mockResolvedValue({ id: 'voice-7', occurredAt: '2026-05-07T10:00:00.000Z' });
    const { container } = await toReview();
    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Voice note ready to send.')).toBeTruthy();
    const send = screen.getByLabelText('Send voice note') as HTMLElement;
    expect(Number.parseInt(send.style.height || send.style.minHeight, 10)).toBe(44);
    expect(Number.parseInt(send.style.width || send.style.minWidth, 10)).toBe(44);
    expect(container.querySelector('[data-icon="arrow-up"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="close"]')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Add a caption (optional)')).toBeNull();
    await act(async () => {
      fireEvent.click(send);
    });
    expect(addMomentSpy).toHaveBeenCalledTimes(1);
    expect(addMomentSpy.mock.calls[0][0]).toMatchObject({
      type: 'trace',
      title: '',
      body: '',
      audioUri: 'file:///voice.m4a',
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'voice-7', at: '2026-05-07T10:00:00.000Z', returnTo: 'us' },
    });
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('save error keeps the take with retry send and hides raw failures', async () => {
    addMomentSpy.mockRejectedValueOnce(new Error('raw boom 999'));
    const { container } = await toReview();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send voice note'));
    });
    expect(screen.getByText('Could not keep this voice note. Please try again.')).toBeTruthy();
    expect(container.textContent).not.toContain('999');
    expect(screen.getByLabelText('Send voice note')).toBeTruthy();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    addMomentSpy.mockResolvedValue({ id: 'voice-8', occurredAt: '2026-05-08T10:00:00.000Z' });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send voice note'));
    });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('failed capture lands in review with discard only, no send', async () => {
    await toReview(null, true);
    expect(screen.getByLabelText('Voice note ready to send.')).toBeTruthy();
    expect(screen.queryByLabelText('Send voice note')).toBeNull();
    fireEvent.click(screen.getByLabelText('Discard voice note'));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(addMomentSpy).not.toHaveBeenCalled();
  });

  it('discard closes without saving', async () => {
    await toReview();
    fireEvent.click(screen.getByLabelText('Discard voice note'));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(addMomentSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
