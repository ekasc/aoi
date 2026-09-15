import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createElement } from 'react';

const TOGETHER_SOURCE = readFileSync('app/(app)/(tabs)/together.tsx', 'utf8');

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
    if (props.accessibilityState && typeof props.accessibilityState.expanded === 'boolean') {
      next['aria-expanded'] = props.accessibilityState.expanded ? 'true' : 'false';
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    // Press-and-hold (Voice button): drive onPressIn/onPressOut with
    // mouseDown/mouseUp so tests can hold and release.
    if (typeof props.onPressIn === 'function') {
      next.onMouseDown = props.onPressIn;
    }
    if (typeof props.onPressOut === 'function') {
      next.onMouseUp = props.onPressOut;
    }
    return next;
  }
  function createDiv(children: any, style: any, props: Record<string, any>) {
    const React = require('react');
    return React.createElement('div', { style: flattenStyle(style), ...withAriaProps(props) }, children);
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
    ScrollView: (props: any) => {
      const { children, style, contentContainerStyle, contentInsetAdjustmentBehavior, showsVerticalScrollIndicator, ...rest } = props;
      return createDiv(children, style, rest);
    },
    ActivityIndicator: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    Pressable: (props: any) => {
      const { children, style, ...rest } = props;
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      const content = typeof children === 'function' ? children({ pressed: false }) : children;
      return createDiv(content, resolved, rest);
    },
    TextInput: (props: any) => {
      const { style, value, onChangeText, placeholder, autoFocus, editable, ...rest } = props;
      const React = require('react');
      return React.createElement('input', {
        style: flattenStyle(style),
        value: value ?? '',
        placeholder,
        autoFocus: autoFocus ? true : undefined,
        'data-autofocus': autoFocus ? 'true' : 'false',
        'data-editable': editable === false ? 'false' : 'true',
        onChange: (event: any) => onChangeText?.(event.target.value),
        ...withAriaProps(rest),
      });
    },
    Modal: (props: any) => {
      const { children, visible, ...rest } = props;
      if (visible === false) {
        return null;
      }
      return createDiv(children, undefined, rest);
    },
    KeyboardAvoidingView: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 320, height: 568 }) },
    useWindowDimensions: () => ({ width: 320, height: 568, scale: 2, fontScale: 1 }),
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const backSpy = vi.fn();
const dismissToSpy = vi.fn();
const addMomentSpy = vi.fn();
let mockSpace: any = null;
const sendSqueezeSpy = vi.fn(async () => {});

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: replaceSpy, dismissTo: dismissToSpy }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
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
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/space/space-avatar-button', () => ({
  SpaceAvatarButton: () => createElement('div', { 'aria-label': 'Shared avatar' }),
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({ letters: [], isLoading: false, error: null, reload: vi.fn(async () => {}) }),
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => ({ state: null, isLoading: false, error: null, reload: vi.fn(async () => {}) }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    addMoment: addMomentSpy,
  }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: mockSqueezeSending }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace, status: 'ready' }),
}));

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement('button', { 'aria-label': 'Record voice', onClick: () => onRecorded('file:///voice.m4a') }, 'Record voice'),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress, disabled, accessibilityState }: { label: string; onPress?: () => void; disabled?: boolean; accessibilityState?: { expanded?: boolean } }) =>
    createElement(
      'button',
      {
        'aria-label': label,
        accessibilityLabel: label,
        ...(accessibilityState && typeof accessibilityState.expanded === 'boolean'
          ? { 'aria-expanded': accessibilityState.expanded ? 'true' : 'false' }
          : {}),
        onClick: disabled ? undefined : onPress,
        disabled: disabled ? true : undefined,
        'data-disabled': disabled ? 'true' : 'false',
      },
      label
    ),
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

let mockSqueezeSending = false;
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

beforeEach(() => {
  mockSpace = null;
  mockSqueezeSending = false;
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
  dismissToSpy.mockClear();
  addMomentSpy.mockReset();
  addMomentSpy.mockResolvedValue({ id: 'saved-1', occurredAt: '2026-05-01T12:00:00.000Z' });
  sendSqueezeSpy.mockClear();
  sendSqueezeSpy.mockResolvedValue(undefined);
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderUs() {
  const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
  return render(createElement(UsScreen));
}

async function expandKeep() {
  fireEvent.click(screen.getByLabelText('Keep a memory'));
  expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('true');
}

describe('Calm disclosure: trio hidden until Keep a memory is asked', () => {
  it('collapsed by default, expands trio and helper, hides via the same toggle', async () => {
    await renderUs();
    expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();
    expect(screen.queryByText('Kept in Memories — voice records there')).toBeNull();
    await expandKeep();
    expect(screen.getByLabelText('Keep a photo memory')).toBeTruthy();
    expect(screen.getByText('Kept in Memories — voice records there')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByText('Kept in Memories — voice records there')).toBeNull();
  });
});

describe('Unified capture: Keep routes to Memories composer (no local sheets)', () => {
  it('Note routes to Memories compose=note with no sheet and no direct save', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    fireEvent.click(screen.getByLabelText('Keep a note memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(screen.queryByText('Keep a note')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('Photo routes to Memories compose=photos with no direct save', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    fireEvent.click(screen.getByLabelText('Keep a photo memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });
    expect(addMomentSpy).not.toHaveBeenCalled();
  });

  it('Voice routes to Memories compose=voice without starting the mic from a param', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    fireEvent.click(screen.getByLabelText('Keep a voice memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
  });
});


describe('Voice capture lives in Memories (no Us overlay, no hold timers)', () => {
  it('Voice Keep target is a plain tap that routes — no hold gate in Us', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    const button = screen.getByLabelText('Keep a voice memory') as HTMLElement;
    expect(button).toBeTruthy();
    // Unified contract: Us never owns hold timing; Memories owns the 350ms guard.
    expect(TOGETHER_SOURCE).toContain("pathname: \"/(app)/(tabs)/(memories)\"");
    expect(TOGETHER_SOURCE).not.toContain('VoiceHoldOverlay');
    expect(TOGETHER_SOURCE).not.toContain('NoteSheet');
    fireEvent.click(button);
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
  });
});


describe('Photo capture routes to Memories', () => {
  it('routes to Memories compose=photos', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    fireEvent.click(screen.getByLabelText('Keep a photo memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('Squeeze compact pill', () => {
  it('is small, centered, with heart 16 and Squeeze label at 320px', async () => {
    const { container } = await renderUs();
    const pill = screen.getByLabelText('Send a squeeze to your partner') as HTMLElement;
    expect(pill.style.minHeight).toMatch(/44/);
    expect(pill.style.minWidth).toMatch(/44/);
    expect(pill.style.alignSelf).toMatch(/center/);
    expect(pill.style.borderRadius).toMatch(/999/);
    expect(screen.getByText('Squeeze')).toBeTruthy();
    const heart = container.querySelector('[data-icon="heart"]') as HTMLElement;
    expect(heart).toBeTruthy();
    expect(heart.style.fontSize).toBe('16px');
    // 44px touch target holds at 320px width (Dimensions mocked to 320).
    expect(Number.parseInt(pill.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(Number.parseInt(pill.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
  });

  it('Sending… then Squeeze sent for 3s with cleanup, safe errors', async () => {
    vi.useFakeTimers();
    await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Squeeze sent')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByText('Squeeze sent')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Squeeze sent')).toBeNull();
    expect(screen.getByText('Squeeze')).toBeTruthy();
  });

  it('safe error without leaking raw failure', async () => {
    sendSqueezeSpy.mockRejectedValueOnce(new Error('raw squeeze boom'));
    const { container } = await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Couldn't send the squeeze. Try again.")).toBeTruthy();
    expect(container.textContent).not.toContain('raw squeeze boom');
  });
});
