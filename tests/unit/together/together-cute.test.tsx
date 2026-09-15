import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createElement } from 'react';

// Calm home: press-state styles resolve as unpressed; Keep toggle expanded
// surfaces as aria-expanded.
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
      const { children, style, value, onChangeText, placeholder, autoFocus, ...rest } = props;
      const React = require('react');
      return React.createElement('input', {
        style: flattenStyle(style),
        value: value ?? '',
        placeholder,
        autoFocus: autoFocus ? true : undefined,
        'data-autofocus': autoFocus ? 'true' : 'false',
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
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const reloadLettersSpy = vi.fn(async () => {});
const reloadQuestionSpy = vi.fn(async () => {});
const refreshMomentsSpy = vi.fn(async () => {});
const sendSqueezeSpy = vi.fn(async () => {});
const addMomentSpy = vi.fn();
const hapticsImpactSpy = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: replaceSpy, dismissTo: vi.fn() }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock('expo-blur', () => ({
  BlurView: (props: any) => {
    const React = require('react');
    return React.createElement('div', { 'aria-label': 'Blur background', style: props.style });
  },
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

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement('button', { 'aria-label': 'Record voice', onClick: () => onRecorded('file:///voice.m4a') }, 'Record voice'),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/space/space-avatar-button', () => ({
  SpaceAvatarButton: () => createElement('div', { 'aria-label': 'Shared avatar' }),
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({
    letters: mockLetters,
    isLoading: false,
    error: null,
    reload: reloadLettersSpy,
  }),
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => ({
    state: mockQuestion,
    isLoading: false,
    error: null,
    reload: reloadQuestionSpy,
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    isLoading: false,
    error: null,
    refresh: refreshMomentsSpy,
    addMoment: addMomentSpy,
  }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: mockSqueezeSending }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace, status: 'ready' }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: (...args: any[]) => hapticsImpactSpy(...args),
  notificationAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress, disabled, accessibilityState }: { label: string; onPress?: () => void; disabled?: boolean; accessibilityState?: { expanded?: boolean } }) =>
    createElement('button', {
      'aria-label': label,
      accessibilityLabel: label,
      ...(accessibilityState && typeof accessibilityState.expanded === 'boolean'
        ? { 'aria-expanded': accessibilityState.expanded ? 'true' : 'false' }
        : {}),
      onClick: disabled ? undefined : onPress,
      disabled: disabled ? true : undefined,
      'data-disabled': disabled ? 'true' : 'false',
    }, label),
}));

let mockSpace: any = null;
let mockLetters: Record<string, any>[] = [];
let mockQuestion: Record<string, any> | null = null;
let mockMoments: Record<string, any>[] = [];
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
  mockLetters = [];
  mockQuestion = null;
  mockSpace = null;
  mockMoments = [];
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
  sendSqueezeSpy.mockClear();
  sendSqueezeSpy.mockResolvedValue(undefined);
  addMomentSpy.mockReset();
  addMomentSpy.mockResolvedValue({ id: 'saved-1', occurredAt: '2026-05-01T12:00:00.000Z' });
  hapticsImpactSpy.mockClear();
  hapticsImpactSpy.mockResolvedValue(undefined);
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderUs() {
  const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
  return render(createElement(UsScreen));
}

async function expandKeep() {
  fireEvent.click(screen.getByLabelText('Keep a memory'));
  expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('true');
}

function flattenForTest(style: any): any {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const s of style) {
      const flat = flattenForTest(s);
      if (flat && typeof flat === 'object') Object.assign(merged, flat);
    }
    return merged;
  }
  return style ?? {};
}

describe('Calm Keep toggle hides trio until asked', () => {
  it('collapsed by default with no capture and no helper', async () => {
    await renderUs();
    expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();
    expect(screen.queryByText('Kept in Memories — voice records there')).toBeNull();
  });

  it('shows camera/pencil/mic glyphs with Photo/Note/Voice labels after expansion', async () => {
    const { container } = await renderUs();
    await expandKeep();
    expect(screen.getByLabelText('Keep a photo memory').textContent).toContain('Photo');
    expect(screen.getByLabelText('Keep a note memory').textContent).toContain('Note');
    expect(screen.getByLabelText('Keep a voice memory').textContent).toContain('Voice');
    expect(container.querySelector('[data-icon="camera"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="pencil"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="mic"]')).toBeTruthy();
    expect(screen.getByText('Kept in Memories — voice records there')).toBeTruthy();
  });

  it('keeps 64px min-height and 44px min-width with instant pressed scale', async () => {
    await renderUs();
    await expandKeep();
    for (const a11y of ['Keep a photo memory', 'Keep a note memory', 'Keep a voice memory']) {
      const el = screen.getByLabelText(a11y) as HTMLElement;
      expect(el.style.minHeight).toMatch(/64/);
      expect(el.style.minWidth).toMatch(/44/);
    }

    const { create, act: rendererAct } = await import('react-test-renderer');
    const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
    let renderer: any;
    await rendererAct(async () => {
      renderer = create(createElement(UsScreen));
    });
    // Expand inside the renderer: collapsed by default.
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Keep a photo memory' }).length).toBe(0);
    await rendererAct(async () => {
      const toggle = renderer.root.findByProps({ 'aria-label': 'Keep a memory' });
      (toggle.props.onClick ?? toggle.props.onPress)?.();
    });
    const keeps = renderer.root.findAllByProps({ accessibilityLabel: 'Keep a photo memory' });
    expect(keeps.length).toBeGreaterThan(0);
    const styleFn = keeps[0].props.style;
    expect(typeof styleFn).toBe('function');
    const resting = flattenForTest(styleFn({ pressed: false }));
    expect(resting.minHeight).toBe(64);
    expect(resting.minWidth).toBe(44);
    expect(resting.opacity).toBeUndefined();
    const pressed = flattenForTest(styleFn({ pressed: true }));
    expect(pressed.opacity).toBeCloseTo(0.9);
    expect(JSON.stringify(pressed.transform)).toContain('0.96');
  });

  it('photo, note, and voice all route to Memories composer with no local capture', async () => {
    await renderUs();
    await expandKeep();
    fireEvent.click(screen.getByLabelText('Keep a photo memory'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });
    fireEvent.click(screen.getByLabelText('Keep a note memory'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(screen.queryByText('Keep a note')).toBeNull();

    fireEvent.click(screen.getByLabelText('Keep a voice memory'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
  });
});

describe('Squeeze accent pill', () => {
  it('is a small centered 44px pill with heart and instant pressed scale', async () => {
    const { container } = await renderUs();
    const pill = screen.getByLabelText('Send a squeeze to your partner') as HTMLElement;
    expect(pill.style.minHeight).toMatch(/44/);
    expect(pill.style.minWidth).toMatch(/44/);
    expect(pill.style.borderRadius).toMatch(/999/);
    expect(pill.style.alignSelf).toMatch(/center/);
    expect(screen.getByText('Squeeze')).toBeTruthy();
    expect(container.querySelector('[data-icon="heart"]')).toBeTruthy();

    const { create, act: rendererAct } = await import('react-test-renderer');
    const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
    let renderer: any;
    await rendererAct(async () => {
      renderer = create(createElement(UsScreen));
    });
    const pills = renderer.root.findAllByProps({ accessibilityLabel: 'Send a squeeze to your partner' });
    expect(pills.length).toBeGreaterThan(0);
    const styleFn = pills[0].props.style;
    expect(typeof styleFn).toBe('function');
    const resting = flattenForTest(styleFn({ pressed: false }));
    expect(resting.minHeight).toBe(44);
    expect(resting.borderRadius).toBe(999);
    const pressed = flattenForTest(styleFn({ pressed: true }));
    expect(pressed.opacity).toBeCloseTo(0.95);
    expect(JSON.stringify(pressed.transform)).toContain('0.98');
  });

  it('sends with a heartbeat double-thump and shows Squeeze sent for 3s, no fake delivery claims', async () => {
    vi.useFakeTimers();
    await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    expect(hapticsImpactSpy).toHaveBeenCalledTimes(1);
    expect(hapticsImpactSpy).toHaveBeenCalledWith('medium');
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(hapticsImpactSpy).toHaveBeenCalledTimes(2);
    expect(hapticsImpactSpy).toHaveBeenNthCalledWith(2, 'medium');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Squeeze sent')).toBeTruthy();
    expect(screen.queryByText('Squeeze', { exact: true })).toBeNull();
    expect(screen.queryByText(/delivered/i)).toBeNull();
    expect(screen.queryByText(/received/i)).toBeNull();
    expect(screen.queryByText(/partner.*got/i)).toBeNull();
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

  it('clears the sent timeout on unmount without leaking', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const rendered = await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Squeeze sent')).toBeTruthy();
    rendered.unmount();
    expect(clearSpy).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    clearSpy.mockRestore();
  });

  it('shows a safe retry message on failure without leaking raw errors', async () => {
    sendSqueezeSpy.mockRejectedValueOnce(new Error('boom raw stack'));
    const { container } = await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Couldn't send the squeeze. Try again.")).toBeTruthy();
    expect(screen.queryByText('Squeeze sent')).toBeNull();
    expect(container.textContent).not.toContain('boom raw stack');
  });
});
